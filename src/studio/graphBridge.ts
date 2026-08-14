import { nanoid } from 'nanoid';
import type { Edge } from '@xyflow/react';
import { enqueueSnackbar } from '../ui/snackbar';
import {
  settleGraphFinalization,
  waitForSettledGraphFinalization,
  type SettledGraphFinalization,
} from './graphFinalization';
import type { FieldProps } from '../components/NodeContent';
import { useFlowStore, type CustomNodeType, type FlowStore } from '../stores/useFlowStore';
import { type NodeData, type NodeParams, useNodesStore } from '../stores/useNodeStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import {
  assertWorkflowOperationContext,
  autoFieldOverrideKey,
  captureWorkflowOperationContext,
  currentAutoResourcePlanTarget,
  isWorkflowOperationCancelled,
  WorkflowOperationCancelledError,
  type WorkflowOperationContext,
  useStudioStore,
} from '../stores/useStudioStore';
import { useWebsocketStore } from '../stores/useWebsocketStore';
import { connectionTypesAreCompatible } from '../theme/connectionTypes';
import fieldAction from '../utils/fieldAction';
import { setManagedGraphSchemaMutationHandler } from '../utils/managedGraphSchemaMutation';
import {
  QWEN_CONTROLNET_REQUIREMENT,
  QWEN_INPAINT_GENERATE_NODE_KEY,
  QWEN_INPAINT_PIPELINE_NODE_KEY,
  QWEN_OUTPAINT_CANVAS_NODE_KEY,
  QWEN_T2I_GENERATE_NODE_KEY,
  QWEN_T2I_PIPELINE_NODE_KEY,
  AUDIO_STUDIO_MODES,
  STUDIO_MODEL_PROFILES,
  VIDEO_STUDIO_MODES,
  WAN_VACE_REVISION,
  getModelRequirementsForMode,
} from './modelProfiles';
import { formPatchForAutoCandidate, selectedAutoCandidate } from './autoResource';
import { exactStudioExecutionProfileForForm, exactStudioExecutionSpecForForm } from './executionSpecs';
import { syncManagedFormControlAliases } from './managedControlSync';
import { resolveStudioResourceForm } from './resourcePlanner';
import { hashString, stableStringify } from './templateExactness';
import { STUDIO_TEMPLATES } from './templates';
import {
  CONTROLLED_ROLE_NODE_KEYS,
  CONTROLLED_WORKFLOW_NODE_KEYS,
  type ControlledGraphContractId,
  type ControlledNodeRole,
} from './controlledWorkflowContracts';
import type {
  StudioFormState,
  StudioExecutionSpec,
  StudioGraphBinding,
  StudioGraphFinalizationState,
  StudioGraphRole,
  StudioMode,
  StudioModelType,
} from './types';

function executionSpecForForm(
  form: Pick<StudioFormState, 'modelType' | 'mode'>,
): StudioExecutionSpec | null | undefined {
  const nodeStore = useNodesStore.getState();
  return exactStudioExecutionSpecForForm(nodeStore.studioModelCapabilities, nodeStore.studioExecutionSpecInvalid, form);
}

function executionSpecForBinding(binding: StudioGraphBinding): StudioExecutionSpec | null | undefined {
  const spec = executionSpecForForm(binding);
  if (!spec) return spec;
  return binding.executionSpec?.schemaVersion === 1 &&
    binding.executionSpec.id === spec.id &&
    binding.executionSpec.contentHash === spec.contentHash &&
    binding.executionSpec.executionProfileId === spec.executionProfileId
    ? spec
    : null;
}

function executionProfileForForm(form: Pick<StudioFormState, 'modelType' | 'mode'>) {
  const capability = useNodesStore.getState().studioModelCapabilities.find((item) => item.modelType === form.modelType);
  const matches = capability?.executionProfiles?.filter((item) => item.modes.includes(form.mode)) ?? [];
  return matches.length === 1 ? matches[0] : undefined;
}

function exactExecutionProfileForForm(form: Pick<StudioFormState, 'modelType' | 'mode'>) {
  const store = useNodesStore.getState();
  return exactStudioExecutionProfileForForm(store.studioModelCapabilities, store.studioExecutionSpecInvalid, form);
}

function expertQuantizationPolicyForForm(form: Pick<StudioFormState, 'modelType' | 'mode'>) {
  return exactExecutionProfileForForm(form)?.expert_quantization_policy;
}

function specRole(spec: StudioExecutionSpec | null | undefined, role: StudioGraphRole) {
  return spec?.roles.find((item) => item[0] === role);
}

function activeAudioTemplateBaseModel() {
  const activeTemplateId = useStudioStore.getState().activeTemplateId;
  if (!activeTemplateId) return undefined;
  const artifact = STUDIO_TEMPLATES.find((template) => template.id === activeTemplateId)?.workflowBlockSettings?.lora
    ?.baseModel;
  return artifact?.source === 'hub' ? artifact.value : undefined;
}

function selectedVisibleGraphAutoCandidate(
  form: StudioFormState,
  binding: StudioGraphBinding | null = useStudioStore.getState().graphBinding,
) {
  const plan = useStudioStore.getState().autoResourcePlan;
  return currentAutoResourcePlanTarget(plan, form, binding) ? null : selectedAutoCandidate(plan, form);
}

function resolveGraphResourceForm(form: StudioFormState): StudioFormState {
  const plannedForm = resolveStudioResourceForm(form);
  if (form.resourceMode !== 'auto') return plannedForm;

  const candidate = selectedVisibleGraphAutoCandidate(plannedForm);
  if (!candidate) return plannedForm;

  // Auto selection points at an already-created artifact. Never reinterpret
  // its artifact format as permission to quantize the base model on load.
  return {
    ...plannedForm,
    ...formPatchForAutoCandidate(candidate),
    quantizationMode: 'none',
  };
}

const NODE_KEYS = {
  models: 'modules.ModularDiffusers.ModelsLoader',
  qwenQuantization: '',
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
  controlPreprocessor: 'modules.ImageFilters.Canny',
  loadControlImage: 'modules.Image.Load',
  loadMask: 'modules.Image.Load',
  applyMask: 'modules.Image.ApplyMask',
  imageEmbeddings: 'modules.ModularDiffusers.ImageEmbeddings',
  imageEncode: 'modules.ModularDiffusers.ImageEncode',
  loadLastImage: 'modules.Image.Load',
  controlnetModel: 'modules.ModularDiffusers.AutoModelLoader',
  controlnet: 'modules.ModularDiffusers.Controlnet',
  diffusersQuantization: 'modules.DiffusersRuntime.PipelineQuantizationConfigV2',
  diffusersRecipe: 'modules.DiffusersRuntime.DiffusersExecutionRecipe',
  wanPipeline: 'modules.DiffusersVideo.LoadPipeline',
  loadVideo: 'modules.Video.Load',
  loadControlVideo: 'modules.Video.Load',
  loadMaskVideo: 'modules.Video.Load',
  loadPoseVideo: 'modules.Video.Load',
  loadFaceVideo: 'modules.Video.Load',
  loadBackgroundVideo: 'modules.Video.Load',
  normalizeVideo: 'modules.VideoConditioning.Normalize',
  alignMaskVideo: 'modules.VideoConditioning.AlignMask',
  videoColor: 'modules.VideoColor.Adjust',
  wanGenerate: 'modules.DiffusersVideo.Generate',
  videoExport: 'modules.Video.Export',
  diffusersImagePipeline: 'modules.DiffusersImage.LoadPipeline',
  diffusersImageGenerate: 'modules.DiffusersImage.Generate',
  diffusersUnconditionalGenerate: 'modules.DiffusersImage.UnconditionalGenerate',
  diffusersPredictMap: 'modules.DiffusersImage.PredictMap',
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
  diffusersThreeDPipeline: 'modules.DiffusersThreeD.LoadPipeline',
  diffusersThreeDGenerate: 'modules.DiffusersThreeD.GenerateRenderedArtifact',
  speechModel: 'modules.HuggingFaceSpeech.LoadSpeechRecognitionModel',
  transcribeAudio: 'modules.HuggingFaceSpeech.TranscribeAudio',
  transcriptPreview: 'modules.Primitive.DataViewer',
  transformersTextModel: 'modules.HuggingFaceTransformers.LoadTextGenerationModel',
  transformersTextGenerate: 'modules.HuggingFaceTransformers.GenerateText',
  transformersImageTextModel: 'modules.HuggingFaceTransformers.LoadImageTextToTextModel',
  transformersImageTextGenerate: 'modules.HuggingFaceTransformers.GenerateImageVideoText',
  transformersTextPreview: 'modules.Primitive.DataViewer',
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
  controlPreprocessor: { x: -520, y: 300 },
  loadControlImage: { x: -520, y: 430 },
  loadMask: { x: -520, y: 560 },
  applyMask: { x: -160, y: 430 },
  imageEmbeddings: { x: -160, y: 300 },
  imageEncode: { x: -160, y: 300 },
  loadLastImage: { x: -520, y: 560 },
  controlnetModel: { x: -160, y: 520 },
  controlnet: { x: 220, y: 300 },
  diffusersQuantization: { x: -1280, y: -80 },
  diffusersRecipe: { x: -900, y: -80 },
  wanPipeline: { x: -520, y: -80 },
  loadVideo: { x: -520, y: 260 },
  loadControlVideo: { x: -520, y: 260 },
  loadMaskVideo: { x: -520, y: 520 },
  loadPoseVideo: { x: -520, y: 520 },
  loadFaceVideo: { x: -160, y: 520 },
  loadBackgroundVideo: { x: 220, y: 520 },
  normalizeVideo: { x: -160, y: 260 },
  alignMaskVideo: { x: -160, y: 520 },
  videoColor: { x: 220, y: 520 },
  wanGenerate: { x: 220, y: -80 },
  videoExport: { x: 640, y: -80 },
  diffusersImagePipeline: { x: -520, y: -80 },
  diffusersImageGenerate: { x: -120, y: -80 },
  diffusersUnconditionalGenerate: { x: 80, y: -80 },
  diffusersPredictMap: { x: -120, y: -80 },
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
  diffusersThreeDPipeline: { x: -520, y: -80 },
  diffusersThreeDGenerate: { x: -120, y: -80 },
  speechModel: { x: -720, y: -80 },
  transcribeAudio: { x: -240, y: -80 },
  transcriptPreview: { x: 240, y: -80 },
  transformersTextModel: { x: -720, y: -80 },
  transformersTextGenerate: { x: -240, y: -80 },
  transformersImageTextModel: { x: -720, y: -80 },
  transformersImageTextGenerate: { x: -240, y: -80 },
  transformersTextPreview: { x: 240, y: -80 },
};

const REQUIRED_BASE_ROLES: StudioGraphRole[] = ['models', 'prompt', 'denoise', 'decode', 'preview'];
const VIDEO_BASE_ROLES: StudioGraphRole[] = ['diffusersRecipe', 'wanPipeline', 'wanGenerate', 'videoExport'];
const COMBINED_CONTROL_ROLES: StudioGraphRole[] = ['loadControlImage', 'controlnetModel', 'controlnet'];
const MODULAR_VIDEO_CORE_ROLES: StudioGraphRole[] = [
  'models',
  'prompt',
  'loadImage',
  'imageEmbeddings',
  'imageEncode',
  'denoise',
  'decode',
  'videoExport',
];
const MODULAR_VIDEO_IDENTITY_ROLES: StudioGraphRole[] = [
  'models',
  'prompt',
  'imageEmbeddings',
  'imageEncode',
  'denoise',
  'decode',
  'loadLastImage',
];

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

let graphUpdatePromise: Promise<BridgeResult> | null = null;
let graphFinalizationPromise: Promise<SettledGraphFinalization<BridgeResult>> | null = null;
let graphFinalizationContext: WorkflowOperationContext | null = null;
let graphFinalizationToken = 0;
let graphDefinitionRevision = 0;
const controlledDefinitionGraphHashes = new Map<string | null, string>();

export type ControlledGraphTransaction = {
  id: string;
  context: WorkflowOperationContext;
  contractId: ControlledGraphContractId;
  binding: StudioGraphBinding;
  finalization: StudioGraphFinalizationState;
  flow: FlowStore;
};

let activeControlledGraphTransaction: ControlledGraphTransaction | null = null;

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

function usesDiffusersImageFacade(form: StudioFormState | Pick<StudioGraphBinding, 'mode' | 'modelType' | 'nodes'>) {
  if ('nodes' in form && form.nodes.diffusersImagePipeline) return true;
  return !('nodes' in form) && executionProfileForForm(form)?.execution_path === 'direct-diffusers-image';
}

function usesDiffusersThreeDFacade(form: StudioFormState | Pick<StudioGraphBinding, 'mode' | 'modelType' | 'nodes'>) {
  if ('nodes' in form && form.nodes.diffusersThreeDPipeline) return true;
  return !('nodes' in form) && executionProfileForForm(form)?.execution_path === 'direct-diffusers-three-d';
}

function usesStaticHuggingFaceExecutionSpec(
  form: Pick<StudioFormState, 'modelType' | 'mode'>,
  binding?: StudioGraphBinding | null,
) {
  const executionSpec = binding ? executionSpecForBinding(binding) : executionSpecForForm(form);
  return executionSpec?.executionPath.startsWith('direct-huggingface-') ?? false;
}

function usesExpertProfileQuantization(form: StudioFormState) {
  const policy = expertQuantizationPolicyForForm(form);
  return (
    form.resourceMode === 'expert' &&
    form.quantizationMode === policy?.quantization_mode &&
    exactExecutionProfileForForm(form)?.execution_path === 'modular-diffusers'
  );
}

function requiredRolesForForm(form: StudioFormState): StudioGraphRole[] {
  const executionSpec = executionSpecForForm(form);
  if (executionSpec === null) throw new Error('The Studio execution specification does not cover this workflow.');
  if (executionSpec) {
    const roles = executionSpec.roles.map(([role]) => role);
    if (usesExpertProfileQuantization(form)) roles.unshift('qwenQuantization');
    return roles;
  }
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
    if (form.mode === 'image_to_video' || form.mode === 'reference_to_video') {
      roles.push('loadImage');
    }
    return roles;
  }

  if (usesDiffusersImageFacade(form)) {
    const runtimeRoles: StudioGraphRole[] = ['diffusersQuantization', 'diffusersRecipe'];
    if (form.mode === 'edit_image' || form.mode === 'multi_image_reference_edit') {
      return [...runtimeRoles, 'diffusersImagePipeline', 'loadImage', 'diffusersImageEdit', 'preview'];
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
  if (usesExpertProfileQuantization(form)) {
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

function hasCompleteCombinedControlGroup(binding: StudioGraphBinding | null | undefined, mode: StudioMode) {
  return (mode === 'edit_image' || mode === 'inpaint') && COMBINED_CONTROL_ROLES.every((role) => binding?.nodes[role]);
}

const modularVideoObservationByNodeId = new Map<string, number>();

function modularVideoObservation(binding: StudioGraphBinding | null | undefined) {
  if (!binding || binding.mode !== 'image_to_video') return 0;
  // LoadImage and VideoExport are also present in the standard video facade,
  // so only Modular-exclusive role claims anchor this group identity.
  const flow = useFlowStore.getState();
  const roleNodes = flow.nodes.filter(
    (node) =>
      binding.managedNodeIds.includes(node.id) &&
      MODULAR_VIDEO_IDENTITY_ROLES.includes(node.data.studioRole as StudioGraphRole),
  );
  const nodeIds = Array.from(
    new Set(
      [...MODULAR_VIDEO_IDENTITY_ROLES.map((role) => binding.nodes[role]), ...roleNodes.map((node) => node.id)].filter(
        isString,
      ),
    ),
  );
  let observation = nodeIds.reduce((value, nodeId) => value | (modularVideoObservationByNodeId.get(nodeId) ?? 0), 0);
  if (nodeIds.length > 0) observation |= 1;
  if (
    binding.nodes.loadLastImage ||
    roleNodes.some((node) => node.data.studioRole === 'loadLastImage') ||
    flow.edges.some(
      (edge) =>
        binding.managedEdgeIds.includes(edge.id) &&
        (edge.sourceHandle === 'last_image' || edge.targetHandle === 'last_image'),
    )
  ) {
    observation |= 2;
  }
  nodeIds.forEach((nodeId) => modularVideoObservationByNodeId.set(nodeId, observation));
  return observation;
}

function modularVideoGroupObserved(binding: StudioGraphBinding | null | undefined) {
  return Boolean(modularVideoObservation(binding) & 1);
}

function modularVideoLastFrameObserved(binding: StudioGraphBinding) {
  return Boolean(modularVideoObservation(binding) & 2);
}

function modularVideoParticipatingRoles(binding: StudioGraphBinding) {
  return modularVideoLastFrameObserved(binding)
    ? [...MODULAR_VIDEO_CORE_ROLES, 'loadLastImage' as const]
    : MODULAR_VIDEO_CORE_ROLES;
}

function participatingRoles(form: StudioFormState, binding?: StudioGraphBinding | null) {
  if (binding && modularVideoGroupObserved(binding)) return modularVideoParticipatingRoles(binding);
  const roles = requiredRolesForForm(form);
  return hasCompleteCombinedControlGroup(binding, form.mode) ? [...roles, ...COMBINED_CONTROL_ROLES] : roles;
}

function hasPartialCombinedControlGroup(binding: StudioGraphBinding) {
  const { imageEncode } = binding.nodes;
  return Boolean(
    imageEncode &&
    COMBINED_CONTROL_ROLES.some((role) => binding.nodes[role]) &&
    !hasCompleteCombinedControlGroup(binding, binding.mode),
  );
}

function bindingFingerprint(form: StudioFormState) {
  const spec = executionSpecForForm(form);
  const receipt = spec ? `:${spec.id}:${spec.contentHash}` : spec === null ? ':invalid-spec' : '';
  return `${form.mode}:${form.modelType}:${form.resourceMode}:${form.quantizationMode}${receipt}`;
}

function bindingMatchesForm(binding: StudioGraphBinding, form: StudioFormState) {
  const spec = executionSpecForBinding(binding);
  return (
    spec !== null &&
    binding.mode === form.mode &&
    binding.modelType === form.modelType &&
    binding.fingerprint === bindingFingerprint(form)
  );
}

function bindingShapeKey(binding: StudioGraphBinding, form: StudioFormState) {
  return `${bindingFingerprint(form)}:${participatingRoles(form, binding).join('|')}`;
}

export function getStudioGraphShapeKey(form: StudioFormState = useStudioStore.getState().form) {
  const plannedForm = resolveGraphResourceForm(form);
  return `${bindingFingerprint(plannedForm)}:${requiredRolesForForm(plannedForm).join('|')}`;
}

function isString(value: string | undefined): value is string {
  return Boolean(value);
}

function isIgnorableCustomGraphNode(node: CustomNodeType) {
  return node.data.type === 'group' || node.data.type === 'loop';
}

function isManagedContainerNode(node: CustomNodeType) {
  return node.type === 'group' || node.type === 'loop' || isIgnorableCustomGraphNode(node);
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

function nodeKeyForFormRole(
  form: Pick<StudioFormState, 'modelType' | 'mode'>,
  role: StudioGraphRole,
  spec?: StudioExecutionSpec | null,
) {
  return (
    specRole(spec, role)?.[1] ??
    (role === 'qwenQuantization' ? expertQuantizationPolicyForForm(form)?.modular_node : NODE_KEYS[role])
  );
}

function nodeKeyForRole(role: StudioGraphRole, binding?: StudioGraphBinding) {
  return binding ? nodeKeyForFormRole(binding, role, executionSpecForBinding(binding)) : NODE_KEYS[role];
}

function nodeMatchesRole(nodeId: string | undefined, role: StudioGraphRole, binding?: StudioGraphBinding) {
  const node = getNode(nodeId);
  return Boolean(node && `${node.data.module}.${node.data.action}` === nodeKeyForRole(role, binding));
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

function getNode(nodeId: string | undefined) {
  if (!nodeId) return undefined;
  return useFlowStore.getState().nodes.find((node) => node.id === nodeId);
}

const GRAPH_PROOF_PARAM_KEYS: Array<keyof NodeParams> = [
  'type',
  'display',
  'hidden',
  'required',
  'isInput',
  'spawn',
  'optionsSource',
  'min',
  'max',
  'step',
  'dataSource',
  'fieldOptions',
];

const REVIEWED_EXECUTION_PARAM_KEYS = [
  'type',
  'display',
  'isInput',
  'spawn',
  'optionsSource',
  'dataSource',
] as const satisfies readonly (keyof NodeParams)[];

function hashGraphProof(value: unknown) {
  return `graph-v1-${hashString(stableStringify(value))}`;
}

function graphProofParamSchema(params: Record<string, NodeParams> | undefined) {
  return Object.fromEntries(
    Object.entries(params ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, param]) => [
        key,
        Object.fromEntries(
          GRAPH_PROOF_PARAM_KEYS.map((paramKey) => [paramKey, param[paramKey]]).filter(
            ([, paramValue]) => paramValue !== undefined,
          ),
        ),
      ]),
  );
}

function managedParamSchemaMatchesRegistry(
  params: Record<string, NodeParams>,
  reviewedParams: Record<string, NodeParams> | undefined,
) {
  if (!reviewedParams) return false;
  for (const [field, reviewedParam] of Object.entries(reviewedParams)) {
    const param = params[field];
    if (
      !param ||
      REVIEWED_EXECUTION_PARAM_KEYS.some((key) => stableStringify(param[key]) !== stableStringify(reviewedParam[key]))
    ) {
      return false;
    }
  }
  return Object.entries(params).every(([field, param]) =>
    (['spawn', 'dataSource'] as const).every(
      (key) => stableStringify(param[key]) === stableStringify(reviewedParams[field]?.[key]),
    ),
  );
}

function fieldSchemaHash(binding: StudioGraphBinding, form: StudioFormState) {
  const nodes = useFlowStore.getState().nodes;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const roles = participatingRoles(form, binding);

  return hashGraphProof({
    nodes: roles.map((role) => {
      const nodeId = binding.nodes[role];
      const node = nodeId ? nodeById.get(nodeId) : undefined;
      return {
        role,
        id: nodeId,
        module: node?.data.module,
        action: node?.data.action,
        params: graphProofParamSchema(node?.data.params),
      };
    }),
  });
}

const CONTROLLED_CONTRACT_ROLES: Partial<Record<ControlledGraphContractId, ControlledNodeRole[]>> = {
  'upscale.image.v1': ['upscaler', 'upscalePreview'],
  'upscale.video.v1': ['upscaler'],
  'upscale.quality-loop.v1': ['upscaler'],
  'video-sequence.v1': ['videoSequence', 'videoCompose'],
  'quality-video.i2v.v1': [
    'qualityVideoQuantization',
    'qualityVideoRecipe',
    'qualityVideoShots',
    'qualityVideoJobs',
    'qualityVideoLoop',
    'qualityVideoLoopItems',
    'qualityVideoGenerate',
    'qualityVideoRetain',
    'qualityVideoLoopResult',
    'qualityVideoJoin',
  ],
  'quality-video.t2v.v1': [
    'qualityVideoQuantization',
    'qualityVideoRecipe',
    'qualityVideoShots',
    'qualityVideoJobs',
    'qualityVideoLoop',
    'qualityVideoLoopItems',
    'qualityVideoGenerate',
    'qualityVideoRetain',
    'qualityVideoLoopResult',
    'qualityVideoJoin',
  ],
  'soundtrack.v1': [
    'soundtrackQuantization',
    'soundtrackRecipe',
    'soundtrackPipeline',
    'soundtrackGenerate',
    'soundtrackAudioFit',
    'exportWithAudio',
  ],
  'lyric-video.v1': [
    'lyricVideoQuantization',
    'lyricVideoRecipe',
    'lyricVideoPipeline',
    'videoSequence',
    'videoCompose',
    'upscaler',
    'lyricOverlay',
    'lyricAudioFit',
    'exportWithAudio',
  ],
};

function isLoraRole(role: string): role is ControlledNodeRole {
  return role === 'loraAdapter' || /^loraAdapter:[1-9][0-9]?$/.test(role);
}

function isControlledRole(role: string): role is ControlledNodeRole {
  return role === 'qualityVideoLoop' || isLoraRole(role) || role in CONTROLLED_ROLE_NODE_KEYS;
}

function controlledRoleNodes() {
  const roles = new Map<ControlledNodeRole, CustomNodeType>();
  let valid = true;
  for (const node of useFlowStore.getState().nodes) {
    const role = node.data.studioRole;
    if (typeof role !== 'string' || !isControlledRole(role)) continue;
    if (roles.has(role)) valid = false;
    roles.set(role, node);
  }
  return { roles, valid };
}

function loraContractId(contractIds: readonly ControlledGraphContractId[]) {
  return contractIds.find((id) => id.startsWith('lora.'));
}

function expectedLoraNodeKey(contractIds: readonly ControlledGraphContractId[]) {
  const contractId = loraContractId(contractIds);
  if (contractId === 'lora.modular.v1') return CONTROLLED_WORKFLOW_NODE_KEYS.lora;
  if (contractId === 'lora.diffusers-image.v1') return CONTROLLED_WORKFLOW_NODE_KEYS.directLora;
  if (contractId === 'lora.diffusers-audio.v1') return CONTROLLED_WORKFLOW_NODE_KEYS.audioLora;
  return undefined;
}

function controlledContractsAreCompatible(
  binding: StudioGraphBinding,
  contractIds: readonly ControlledGraphContractId[],
) {
  const contracts = new Set(contractIds);
  const loraContracts = contractIds.filter((id) => id.startsWith('lora.'));
  const upscaleContracts = contractIds.filter((id) => id.startsWith('upscale.'));
  const qualityContracts = contractIds.filter((id) => id.startsWith('quality-video.'));
  if (
    contractIds.length === 0 ||
    contractIds.length > 16 ||
    contracts.size !== contractIds.length ||
    loraContracts.length > 1 ||
    upscaleContracts.length > 1 ||
    qualityContracts.length > 1
  ) {
    return false;
  }
  if (contracts.has('lora.modular.v1') && !binding.nodes.models) return false;
  if (contracts.has('lora.diffusers-image.v1') && !binding.nodes.diffusersImagePipeline) return false;
  if (contracts.has('lora.diffusers-audio.v1') && !binding.nodes.audioPipeline) return false;
  if (contracts.has('upscale.image.v1') && (isVideoMode(binding.mode) || isAudioMode(binding.mode))) return false;
  if (contracts.has('upscale.video.v1') && !isVideoMode(binding.mode)) return false;
  if (contracts.has('video-sequence.v1') && !isVideoMode(binding.mode)) return false;
  if (contracts.has('quality-video.i2v.v1') && binding.mode !== 'image_to_video') return false;
  if (contracts.has('quality-video.t2v.v1') && binding.mode !== 'text_to_video') return false;
  if (contracts.has('upscale.quality-loop.v1') !== (qualityContracts.length === 1 && upscaleContracts.length === 1)) {
    return false;
  }
  if (qualityContracts.length && (contracts.has('video-sequence.v1') || contracts.has('soundtrack.v1'))) return false;
  if (contracts.has('soundtrack.v1') && !isVideoMode(binding.mode)) return false;
  if (
    contracts.has('lyric-video.v1') &&
    (!isAudioMode(binding.mode) || contractIds.some((id) => id.includes('video-sequence')))
  ) {
    return false;
  }
  return true;
}

function contractExpectedRoles(contractIds: readonly ControlledGraphContractId[]) {
  const roles = new Set<ControlledNodeRole>();
  contractIds.forEach((id) => CONTROLLED_CONTRACT_ROLES[id]?.forEach((role) => roles.add(role)));
  return roles;
}

function sortedLoraNodes(roles: Map<ControlledNodeRole, CustomNodeType>) {
  return [...roles.entries()]
    .filter(([role]) => isLoraRole(role))
    .sort(([left], [right]) => {
      const index = (role: string) => (role === 'loraAdapter' ? 0 : Number(role.split(':')[1]));
      return index(left) - index(right);
    })
    .map(([, node]) => node);
}

function expectedControlledEdgeSpecs(
  binding: StudioGraphBinding,
  contractIds: readonly ControlledGraphContractId[],
  roles: Map<ControlledNodeRole, CustomNodeType>,
) {
  let valid = true;
  const specs = new Map(
    baseDesiredEdgeSpecs(binding).map((spec) => [
      edgeKey(spec.source, spec.sourceHandle, spec.target, spec.targetHandle),
      spec,
    ]),
  );
  const add = (...items: Array<StudioEdgeSpec | null | undefined>) => {
    if (items.some((item) => !item)) valid = false;
    items
      .filter((item): item is StudioEdgeSpec => Boolean(item))
      .forEach((item) => {
        specs.set(edgeKey(item.source, item.sourceHandle, item.target, item.targetHandle), item);
      });
  };
  const remove = (predicate: (spec: StudioEdgeSpec) => boolean) => {
    [...specs.entries()].forEach(([key, spec]) => {
      if (predicate(spec)) specs.delete(key);
    });
  };
  const id = (role: ControlledNodeRole) => roles.get(role)?.id;
  const contracts = new Set(contractIds);
  const loraNodes = sortedLoraNodes(roles);
  const loraId = loraContractId(contractIds);

  if (loraId === 'lora.modular.v1') {
    add(makeConnectionSpec(loraNodes[0]?.id, ['lora'], binding.nodes.models, ['lora_list', 'loras']));
  } else if (loraId === 'lora.diffusers-image.v1' || loraId === 'lora.diffusers-audio.v1') {
    const pipeline =
      loraId === 'lora.diffusers-image.v1' ? binding.nodes.diffusersImagePipeline : binding.nodes.audioPipeline;
    const generate =
      loraId === 'lora.diffusers-image.v1'
        ? (binding.nodes.diffusersImageInpaint ??
          binding.nodes.diffusersImageControl ??
          binding.nodes.diffusersImageEdit ??
          binding.nodes.diffusersImageGenerate)
        : binding.nodes.audioGenerate;
    remove((spec) => spec.source === pipeline && spec.target === generate);
    add(makeConnectionSpec(pipeline, ['pipeline'], loraNodes[0]?.id, ['pipeline']));
    for (let index = 1; index < loraNodes.length; index += 1) {
      add(makeConnectionSpec(loraNodes[index - 1]?.id, ['output'], loraNodes[index]?.id, ['pipeline']));
    }
    add(makeConnectionSpec(loraNodes[loraNodes.length - 1]?.id, ['output'], generate, ['pipeline']));
  }

  const sequence = id('videoSequence');
  const compose = id('videoCompose');
  const upscaler = id('upscaler');
  if (contracts.has('video-sequence.v1')) {
    remove((spec) => spec.source === binding.nodes.wanGenerate || spec.target === binding.nodes.wanGenerate);
    add(
      makeConnectionSpec(binding.nodes.wanPipeline, ['pipeline'], sequence, ['pipeline']),
      makeConnectionSpec(sequence, ['clips'], compose, ['clip_1']),
    );
  }

  if (contracts.has('upscale.image.v1')) {
    const source = usesDiffusersImageFacade(binding)
      ? (binding.nodes.diffusersImageInpaint ??
        binding.nodes.diffusersImageControl ??
        binding.nodes.diffusersImageEdit ??
        binding.nodes.diffusersImageGenerate)
      : binding.nodes.decode;
    add(
      makeConnectionSpec(source, ['images', 'image', 'output'], upscaler, IMAGE_HANDLE),
      makeConnectionSpec(upscaler, ['output', 'image'], id('upscalePreview'), IMAGE_HANDLE),
    );
  }

  if (contracts.has('upscale.video.v1') || contracts.has('video-sequence.v1')) {
    const deliverySource = contracts.has('video-sequence.v1') ? compose : binding.nodes.wanGenerate;
    remove((spec) => spec.target === binding.nodes.videoExport && spec.source === deliverySource);
    if (contracts.has('upscale.video.v1')) {
      add(
        makeConnectionSpec(deliverySource, compose ? ['video'] : ['video_out'], upscaler, IMAGE_HANDLE),
        makeConnectionSpec(upscaler, ['output', 'image'], binding.nodes.videoExport, ['video']),
      );
    } else {
      add(makeConnectionSpec(deliverySource, ['video'], binding.nodes.videoExport, ['video']));
    }
  }

  const qualityId = contractIds.find((contractId) => contractId.startsWith('quality-video.'));
  if (qualityId) {
    remove(
      (spec) =>
        spec.source === binding.nodes.wanGenerate ||
        spec.target === binding.nodes.wanGenerate ||
        spec.source === binding.nodes.videoExport ||
        spec.target === binding.nodes.videoExport ||
        (spec.source === binding.nodes.diffusersRecipe && spec.target === binding.nodes.wanPipeline),
    );
    const generate = id('qualityVideoGenerate');
    const retain = id('qualityVideoRetain');
    add(
      makeConnectionSpec(id('qualityVideoQuantization'), ['quantization_config'], id('qualityVideoRecipe'), [
        'quantization_config',
      ]),
      makeConnectionSpec(id('qualityVideoRecipe'), ['execution_recipe'], binding.nodes.wanPipeline, [
        'execution_recipe',
      ]),
      makeConnectionSpec(id('qualityVideoShots'), ['shots'], id('qualityVideoJobs'), ['shots']),
      ...(qualityId === 'quality-video.i2v.v1'
        ? [makeConnectionSpec(binding.nodes.loadImage, IMAGE_HANDLE, id('qualityVideoJobs'), ['opening_images'])]
        : []),
      makeConnectionSpec(id('qualityVideoJobs'), ['jobs'], id('qualityVideoLoopItems'), ['collection']),
      makeConnectionSpec(binding.nodes.wanPipeline, ['pipeline'], generate, ['pipeline']),
      makeConnectionSpec(id('qualityVideoLoopItems'), ['item'], generate, ['job']),
      makeConnectionSpec(generate, ['fps_out'], retain, ['fps']),
      makeConnectionSpec(retain, ['asset'], id('qualityVideoLoopResult'), ['value_input']),
      makeConnectionSpec(id('qualityVideoLoopResult'), ['collection'], id('qualityVideoJoin'), ['clips']),
    );
    if (contracts.has('upscale.quality-loop.v1')) {
      add(
        makeConnectionSpec(generate, ['video_out'], upscaler, IMAGE_HANDLE),
        makeConnectionSpec(upscaler, ['output', 'image'], retain, ['video']),
      );
    } else {
      add(makeConnectionSpec(generate, ['video_out'], retain, ['video']));
    }
  }

  if (contracts.has('soundtrack.v1')) {
    const videoSource = upscaler ?? compose ?? binding.nodes.wanGenerate;
    remove((spec) => spec.target === binding.nodes.videoExport);
    add(
      makeConnectionSpec(id('soundtrackQuantization'), ['quantization_config'], id('soundtrackRecipe'), [
        'quantization_config',
      ]),
      makeConnectionSpec(id('soundtrackRecipe'), ['execution_recipe'], id('soundtrackPipeline'), ['execution_recipe']),
      makeConnectionSpec(id('soundtrackPipeline'), ['pipeline'], id('soundtrackGenerate'), ['pipeline']),
      makeConnectionSpec(id('soundtrackGenerate'), ['audio'], id('soundtrackAudioFit'), ['audio']),
      makeConnectionSpec(id('soundtrackAudioFit'), ['output'], id('exportWithAudio'), ['audio']),
      makeConnectionSpec(
        videoSource,
        upscaler ? ['output', 'image'] : compose ? ['video'] : ['video_out'],
        id('exportWithAudio'),
        ['video'],
      ),
    );
  }

  if (contracts.has('lyric-video.v1')) {
    add(
      makeConnectionSpec(id('lyricVideoQuantization'), ['quantization_config'], id('lyricVideoRecipe'), [
        'quantization_config',
      ]),
      makeConnectionSpec(id('lyricVideoRecipe'), ['execution_recipe'], id('lyricVideoPipeline'), ['execution_recipe']),
      makeConnectionSpec(id('lyricVideoPipeline'), ['pipeline'], sequence, ['pipeline']),
      makeConnectionSpec(sequence, ['clips'], compose, ['clip_1']),
      makeConnectionSpec(compose, ['video'], upscaler, IMAGE_HANDLE),
      makeConnectionSpec(upscaler, ['output'], id('lyricOverlay'), ['video']),
      makeConnectionSpec(id('lyricOverlay'), ['output'], id('exportWithAudio'), ['video']),
      makeConnectionSpec(binding.nodes.audioGenerate, ['audio'], id('lyricAudioFit'), ['audio']),
      makeConnectionSpec(id('lyricAudioFit'), ['output'], id('exportWithAudio'), ['audio']),
    );
  }

  return valid ? [...specs.values()] : null;
}

function controlledGraphFieldSchemaHash(binding: StudioGraphBinding) {
  const nodes = new Map(useFlowStore.getState().nodes.map((node) => [node.id, node]));
  return hashGraphProof(
    binding.managedNodeIds
      .map((nodeId) => {
        const node = nodes.get(nodeId);
        return [
          nodeId,
          node?.data.studioRole,
          node?.data.module,
          node?.data.action,
          graphProofParamSchema(node?.data.params),
        ];
      })
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
  );
}

function controlledGraphHash(binding: StudioGraphBinding, contractIds: readonly ControlledGraphContractId[]) {
  const flow = useFlowStore.getState();
  const managed = new Set(binding.managedNodeIds);
  const nodes = flow.nodes
    .filter((node) => managed.has(node.id))
    .map((node) => [
      node.id,
      node.data.studioRole,
      graphNodeKey(node),
      node.type,
      node.data.type,
      node.parentId ?? null,
      node.data.uiState?.disabled === true,
      node.data.studioRole === 'qualityVideoLoop'
        ? ['iteration_mode', 'iterations', 'max_iterations', 'carry', 'collect', 'durable', 'max_retries'].map(
            (key) => node.data.params[key]?.value,
          )
        : null,
    ])
    .sort(([left], [right]) => String(left).localeCompare(String(right)));
  const edges = flow.edges
    .filter((edge) => managed.has(edge.source) || managed.has(edge.target))
    .map((edge) => [edge.id, edge.source, edge.sourceHandle ?? null, edge.target, edge.targetHandle ?? null])
    .sort(([left], [right]) => String(left).localeCompare(String(right)));
  return hashGraphProof([
    contractIds,
    Object.entries(binding.nodes).sort(([left], [right]) => left.localeCompare(right)),
    nodes,
    edges,
  ]);
}

function controlledGraphSemanticsAreValid(binding: StudioGraphBinding, form: StudioFormState) {
  const contractIds = binding.controlled?.contractIds;
  if (
    binding.controlled?.schemaVersion !== 1 ||
    binding.controlled.contractRevision !== 1 ||
    !contractIds ||
    !controlledContractsAreCompatible(binding, contractIds) ||
    !bindingMatchesForm(binding, form) ||
    !participatingRoleNodesAreValid(binding, form)
  ) {
    return false;
  }
  const baseRoles = participatingRoles(form, binding);
  const declaredBaseRoles = Object.entries(binding.nodes).filter(([, nodeId]) => typeof nodeId === 'string');
  if (
    declaredBaseRoles.length !== baseRoles.length ||
    declaredBaseRoles.some(([role]) => !baseRoles.includes(role as StudioGraphRole)) ||
    baseRoles.some((role) => {
      const node = getNode(binding.nodes[role]);
      return !nodeMatchesRole(node?.id, role, binding) || !node || node.parentId || isManagedContainerNode(node);
    })
  ) {
    return false;
  }
  const { roles, valid } = controlledRoleNodes();
  if (!valid) return false;
  const expectedRoles = contractExpectedRoles(contractIds);
  const loraKey = expectedLoraNodeKey(contractIds);
  const loraNodes = sortedLoraNodes(roles);
  if (loraKey) {
    if (loraNodes.length === 0 || loraNodes.length > 8) return false;
    loraNodes.forEach((_, index) => expectedRoles.add(index === 0 ? 'loraAdapter' : `loraAdapter:${index}`));
  } else if (loraNodes.length > 0) {
    return false;
  }
  if (expectedRoles.size !== roles.size || [...expectedRoles].some((role) => !roles.has(role))) return false;
  for (const [role, node] of roles) {
    if (!node.data.studioOwned || !binding.managedNodeIds.includes(node.id)) return false;
    if (role === 'qualityVideoLoop') {
      if (node.type !== 'loop' || node.data.type !== 'loop' || node.parentId) return false;
    } else if (graphNodeKey(node) !== (isLoraRole(role) ? loraKey : CONTROLLED_ROLE_NODE_KEYS[role])) {
      return false;
    } else if (isManagedContainerNode(node)) {
      return false;
    }
  }

  const expectedManaged = new Set([
    ...baseRoles.map((role) => binding.nodes[role]).filter(isString),
    ...[...roles.values()].map((node) => node.id),
  ]);
  if (
    expectedManaged.size !== binding.managedNodeIds.length ||
    binding.managedNodeIds.some((nodeId) => !expectedManaged.has(nodeId))
  ) {
    return false;
  }

  const registry = useNodesStore.getState().nodesRegistry;
  for (const nodeId of binding.managedNodeIds) {
    const node = getNode(nodeId);
    const reviewedParams = node ? registry[graphNodeKey(node)]?.params : undefined;
    if (
      !node ||
      (node.data.studioRole !== 'qualityVideoLoop' &&
        !managedParamSchemaMatchesRegistry(node.data.params, reviewedParams))
    ) {
      return false;
    }
  }

  const disabled = new Set<string>();
  const contracts = new Set(contractIds);
  if (contracts.has('video-sequence.v1')) disabled.add(binding.nodes.wanGenerate ?? '');
  if (contractIds.some((id) => id.startsWith('quality-video.'))) {
    disabled.add(binding.nodes.wanGenerate ?? '');
    disabled.add(binding.nodes.videoExport ?? '');
  }
  if (contracts.has('soundtrack.v1')) disabled.add(binding.nodes.videoExport ?? '');
  for (const nodeId of binding.managedNodeIds) {
    const node = getNode(nodeId);
    if (!node || (node.data.uiState?.disabled === true) !== disabled.has(nodeId)) return false;
  }

  const qualityLoop = roles.get('qualityVideoLoop');
  if (contractIds.some((id) => id.startsWith('quality-video.'))) {
    if (!qualityLoop) return false;
    const qualityBody: ControlledNodeRole[] = [
      'qualityVideoLoopItems',
      'qualityVideoGenerate',
      'qualityVideoRetain',
      'qualityVideoLoopResult',
    ];
    if (contracts.has('upscale.quality-loop.v1')) qualityBody.push('upscaler');
    if (qualityBody.some((role) => roles.get(role)?.parentId !== qualityLoop.id)) return false;
    if (
      qualityLoop.data.params.iteration_mode?.value !== 'collection' ||
      qualityLoop.data.params.iterations?.value !== 6 ||
      qualityLoop.data.params.max_iterations?.value !== 6 ||
      qualityLoop.data.params.carry?.value !== false ||
      qualityLoop.data.params.collect?.value !== true ||
      qualityLoop.data.params.durable?.value !== true ||
      qualityLoop.data.params.max_retries?.value !== 1
    ) {
      return false;
    }
  }
  for (const [role, node] of roles) {
    if (
      role !== 'qualityVideoLoop' &&
      !['qualityVideoLoopItems', 'qualityVideoGenerate', 'qualityVideoRetain', 'qualityVideoLoopResult'].includes(
        role,
      ) &&
      !(role === 'upscaler' && contracts.has('upscale.quality-loop.v1')) &&
      node.parentId
    ) {
      return false;
    }
  }

  const expectedSpecs = expectedControlledEdgeSpecs(binding, contractIds, roles);
  if (
    !expectedSpecs ||
    expectedSpecs.some((spec) => {
      const source = getNodeParam(spec.source, spec.sourceHandle);
      const target = getNodeParam(spec.target, spec.targetHandle);
      return (
        !source ||
        !target ||
        source.isInput === true ||
        source.display !== 'output' ||
        !(target.isInput === true || target.display === 'input') ||
        source.type === undefined ||
        target.type === undefined ||
        !connectionTypesAreCompatible(source.type, target.type)
      );
    })
  ) {
    return false;
  }
  const flow = useFlowStore.getState();
  const managed = new Set(binding.managedNodeIds);
  const touchingEdges = flow.edges.filter((edge) => managed.has(edge.source) || managed.has(edge.target));
  const edgeIds = touchingEdges.map((edge) => edge.id);
  const edgeKeys = touchingEdges.map((edge) => edgeKey(edge.source, edge.sourceHandle, edge.target, edge.targetHandle));
  const expectedKeys = expectedSpecs.map((spec) =>
    edgeKey(spec.source, spec.sourceHandle, spec.target, spec.targetHandle),
  );
  return (
    new Set(edgeIds).size === edgeIds.length &&
    new Set(edgeKeys).size === edgeKeys.length &&
    edgeIds.length === binding.managedEdgeIds.length &&
    edgeIds.every((edgeId) => binding.managedEdgeIds.includes(edgeId)) &&
    edgeKeys.length === expectedKeys.length &&
    edgeKeys.every((key) => expectedKeys.includes(key)) &&
    (!requiresDynamicGraphChannel(form, binding) || legacyDynamicFieldGroupsAreFinalized(binding)) &&
    !inspectStudioGraphBindingDivergence(binding)
  );
}

function bindingWithFinalizationProof(
  binding: StudioGraphBinding,
  form: StudioFormState,
  finalizedAt = Date.now(),
): StudioGraphBinding {
  const plannedForm = resolveGraphResourceForm(form);
  if (!bindingMatchesForm(binding, plannedForm)) {
    return { ...binding, finalizationProof: undefined };
  }
  if (binding.controlled) {
    if (!controlledGraphSemanticsAreValid(binding, plannedForm)) {
      return { ...binding, finalizationProof: undefined, finalizationProofInvalid: true };
    }
    return {
      ...binding,
      finalizationProofInvalid: undefined,
      finalizationProof: {
        schemaVersion: 3,
        canonicalizationVersion: 1,
        contractRevision: 1,
        shapeKey: bindingShapeKey(binding, plannedForm),
        fieldSchemaHash: controlledGraphFieldSchemaHash(binding),
        managedGraphHash: controlledGraphHash(binding, binding.controlled.contractIds),
        contractIds: binding.controlled.contractIds,
        finalizedAt,
      },
      updatedAt: finalizedAt,
    };
  }
  return {
    ...binding,
    finalizationProofInvalid: undefined,
    finalizationProof: {
      schemaVersion: 2,
      shapeKey: bindingShapeKey(binding, plannedForm),
      fieldSchemaHash: fieldSchemaHash(binding, plannedForm),
      edgeSpecHash: desiredEdgeSpecHash(binding),
      finalizedAt,
    },
    updatedAt: finalizedAt,
  };
}

function bindingFinalizationSchemaProofMatches(binding: StudioGraphBinding, form: StudioFormState) {
  const proof = binding.finalizationProof;
  const plannedForm = resolveGraphResourceForm(form);
  return (
    proof?.schemaVersion === 2 &&
    proof.shapeKey === bindingShapeKey(binding, plannedForm) &&
    proof.fieldSchemaHash === fieldSchemaHash(binding, plannedForm)
  );
}

function bindingFinalizationProofMatches(binding: StudioGraphBinding, form: StudioFormState) {
  const proof = binding.finalizationProof;
  const plannedForm = resolveGraphResourceForm(form);
  if (binding.controlled && proof?.schemaVersion !== 3) return false;
  if (proof?.schemaVersion === 3) {
    const contractIds = binding.controlled?.contractIds;
    return Boolean(
      !binding.finalizationProofInvalid &&
      binding.controlled?.schemaVersion === 1 &&
      binding.controlled.contractRevision === proof.contractRevision &&
      proof.canonicalizationVersion === 1 &&
      contractIds &&
      proof.contractIds.length === contractIds.length &&
      proof.contractIds.every((id, index) => id === contractIds[index]) &&
      proof.shapeKey === bindingShapeKey(binding, plannedForm) &&
      proof.fieldSchemaHash === controlledGraphFieldSchemaHash(binding) &&
      proof.managedGraphHash === controlledGraphHash(binding, contractIds) &&
      controlledGraphSemanticsAreValid(binding, plannedForm),
    );
  }
  return (
    bindingFinalizationSchemaProofMatches(binding, plannedForm) &&
    proof?.edgeSpecHash === desiredEdgeSpecHash(binding) &&
    bindingHasExecutableFinalizationShape(binding, plannedForm)
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

const ROUTE_STATE_OUT = ['route_state_out'];
const ROUTE_STATE_IN = ['route_state_in'];
const IMAGE_HANDLE = ['image'];
const MASK_IMAGE_HANDLE = ['mask_image'];
const IMAGE_LATENTS_OUT = ['image_latents'];
const IMAGE_LATENTS_IN = ['image_latents', 'image_latents_with_strength'];
const INPAINT_MASK = ['mask'];
const MASKED_IMAGE_LATENTS = ['masked_image_latents'];
const CONTROL_ROUTE = 2;
const observedTypedRoutes = new Set<string>();

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

function authoritativeTypedHandle(nodeId: string | undefined, fieldKeys: string[], output = false) {
  const param = getNodeParam(nodeId, fieldKeys[0]);
  if (!param) return undefined;
  const type = param.type;
  return param.display === (output ? 'output' : 'input') && typeof type === 'string' && type === type.trim() && type
    ? type
    : null;
}

function hasManagedTypedEdge(
  binding: StudioGraphBinding,
  source: string | undefined,
  target: string | undefined,
  handles: string[],
) {
  const managedEdges = new Set(binding.managedEdgeIds);
  return useFlowStore
    .getState()
    .edges.some(
      (edge) =>
        managedEdges.has(edge.id) &&
        edge.source === source &&
        edge.target === target &&
        (handles.includes(edge.sourceHandle ?? '') || handles.includes(edge.targetHandle ?? '')),
    );
}

function modularDenoiseVaeTopology(binding: StudioGraphBinding) {
  const { models, denoise } = binding.nodes;
  const key = `vae:${binding.fingerprint}:${binding.createdAt}:${models ?? ''}:${denoise ?? ''}`;
  const types = [authoritativeTypedHandle(models, ['vae_out'], true), authoritativeTypedHandle(denoise, ['vae'])];
  const observed = types[1] !== undefined || hasManagedTypedEdge(binding, models, denoise, ['vae_out', 'vae']);
  if (observed) observedTypedRoutes.add(key);
  if (!observed && !observedTypedRoutes.has(key)) return undefined;
  return Boolean(types[0] && types[0] === types[1]);
}

function controlImageLoader(binding: StudioGraphBinding) {
  const { imageEncode, loadControlImage, loadImage } = binding.nodes;
  return imageEncode && binding.mode !== 'edit_image' && binding.mode !== 'inpaint'
    ? undefined
    : (loadControlImage ?? (!imageEncode ? loadImage : undefined));
}

function modularRouteTopology(binding: StudioGraphBinding) {
  const { imageEncode, controlnet, denoise, decode } = binding.nodes;
  if (hasPartialCombinedControlGroup(binding)) return false;
  const imageRouteOut = authoritativeTypedHandle(imageEncode, ROUTE_STATE_OUT, true);
  const controlRouteIn = authoritativeTypedHandle(controlnet, ROUTE_STATE_IN);
  const controlRouteOut = authoritativeTypedHandle(controlnet, ROUTE_STATE_OUT, true);
  const denoiseRouteIn = authoritativeTypedHandle(denoise, ROUTE_STATE_IN);
  const controlRouteObserved = controlRouteIn !== undefined || controlRouteOut !== undefined;
  const routeHandles = [
    authoritativeTypedHandle(denoise, ROUTE_STATE_OUT, true),
    authoritativeTypedHandle(decode, ROUTE_STATE_IN),
  ];
  if (controlRouteObserved) {
    routeHandles.unshift(controlRouteIn, controlRouteOut, denoiseRouteIn);
    if (imageEncode) routeHandles.unshift(imageRouteOut);
  } else if (imageEncode) routeHandles.unshift(imageRouteOut, denoiseRouteIn);
  const maskTarget = binding.mode === 'inpaint' ? authoritativeTypedHandle(imageEncode, MASK_IMAGE_HANDLE) : undefined;
  if (!routeHandles.some((type) => type !== undefined) && maskTarget === undefined) return undefined;

  const routeType = routeHandles[0];
  return routeType &&
    routeHandles.every((type) => type === routeType) &&
    (binding.mode !== 'inpaint' ||
      (maskTarget && maskTarget === authoritativeTypedHandle(binding.nodes.loadMask, IMAGE_HANDLE, true)))
    ? controlRouteObserved
      ? CONTROL_ROUTE
      : 1
    : false;
}

function modularInpaintStateTopology(binding: StudioGraphBinding) {
  if (binding.mode !== 'inpaint') return undefined;
  const { imageEncode, denoise } = binding.nodes;
  const key = `inpaint:${binding.fingerprint}:${binding.createdAt}:${imageEncode ?? ''}:${denoise ?? ''}`;
  const denoiseVae = modularDenoiseVaeTopology(binding);
  const stateTypes = [
    authoritativeTypedHandle(imageEncode, INPAINT_MASK, true),
    authoritativeTypedHandle(denoise, INPAINT_MASK),
    authoritativeTypedHandle(imageEncode, MASKED_IMAGE_LATENTS, true),
    authoritativeTypedHandle(denoise, MASKED_IMAGE_LATENTS),
  ];
  const observed =
    denoiseVae !== undefined ||
    stateTypes.some((type) => type !== undefined) ||
    hasManagedTypedEdge(binding, imageEncode, denoise, [...INPAINT_MASK, ...MASKED_IMAGE_LATENTS]);
  if (observed) observedTypedRoutes.add(key);
  if (!observed && !observedTypedRoutes.has(key)) return undefined;
  return Boolean(
    denoiseVae === true &&
    modularRouteTopology(binding) === 1 &&
    stateTypes[0] &&
    stateTypes[0] === stateTypes[1] &&
    stateTypes[2] &&
    stateTypes[2] === stateTypes[3],
  );
}

const MODULAR_VIDEO_I2V_EDGE_HANDLES = [
  ['models', 'text_encoders', 'prompt', 'text_encoders'],
  ['models', 'image_encoder', 'imageEmbeddings', 'image_encoder'],
  ['models', 'vae_out', 'imageEncode', 'vae'],
  ['models', 'unet_out', 'denoise', 'unet'],
  ['models', 'scheduler', 'denoise', 'scheduler'],
  ['models', 'vae_out', 'denoise', 'vae'],
  ['models', 'vae_out', 'decode', 'vae'],
  ['loadImage', 'image', 'imageEmbeddings', 'image'],
  ['loadImage', 'image', 'imageEncode', 'image'],
  ['prompt', 'embeddings', 'denoise', 'embeddings'],
  ['imageEmbeddings', 'image_embeds', 'denoise', 'image_embeds'],
  ['imageEmbeddings', 'route_state_out', 'imageEncode', 'route_state_in'],
  ['imageEncode', 'image_condition_latents', 'denoise', 'image_condition_latents'],
  ['imageEncode', 'route_state_out', 'denoise', 'route_state_in'],
  ['denoise', 'latents', 'decode', 'latents'],
  ['denoise', 'route_state_out', 'decode', 'route_state_in'],
  ['decode', 'videos', 'videoExport', 'video'],
] as const satisfies ReadonlyArray<readonly [StudioGraphRole, string, StudioGraphRole, string]>;

const MODULAR_VIDEO_LAST_FRAME_EDGE_HANDLES = [
  ['loadLastImage', 'image', 'imageEmbeddings', 'last_image'],
  ['loadLastImage', 'image', 'imageEncode', 'last_image'],
] as const satisfies ReadonlyArray<readonly [StudioGraphRole, string, StudioGraphRole, string]>;

function exactTypedEdgeSpec(
  binding: StudioGraphBinding,
  [sourceRole, sourceHandle, targetRole, targetHandle]: readonly [StudioGraphRole, string, StudioGraphRole, string],
) {
  const source = binding.nodes[sourceRole];
  const target = binding.nodes[targetRole];
  const sourceType = authoritativeTypedHandle(source, [sourceHandle], true);
  const targetParam = getNodeParam(target, targetHandle);
  const targetTypes = Array.isArray(targetParam?.type) ? targetParam.type : [targetParam?.type];
  if (!source || !target || !sourceType || targetParam?.display !== 'input' || !targetTypes.includes(sourceType))
    return null;
  return { source, sourceHandle, target, targetHandle } satisfies StudioEdgeSpec;
}

function exactScalarParam(nodeId: string | undefined, fieldKey: string, type: string, display?: string) {
  const param = getNodeParam(nodeId, fieldKey);
  return Boolean(
    param &&
    param.type === type &&
    (display === undefined ? !param.display : param.display === display) &&
    !param.isInput,
  );
}

function modularVideoControlContractComplete(binding: StudioGraphBinding) {
  const { imageEmbeddings, imageEncode, denoise } = binding.nodes;
  return [
    [imageEmbeddings, 'width'],
    [imageEmbeddings, 'height'],
    [imageEncode, 'width'],
    [imageEncode, 'height'],
    [imageEncode, 'num_frames', 'slider'],
    [imageEncode, 'seed', 'random'],
    [denoise, 'width'],
    [denoise, 'height'],
    [denoise, 'num_frames', 'slider'],
    [denoise, 'seed', 'random'],
  ].every(([nodeId, field, display]) => exactScalarParam(nodeId, field!, 'int', display));
}

function modularVideoRouteContractComplete(binding: StudioGraphBinding) {
  const { imageEmbeddings, imageEncode, denoise, decode } = binding.nodes;
  const routeTypes = [imageEmbeddings, imageEncode, imageEncode, denoise, denoise, decode].map((nodeId, index) =>
    authoritativeTypedHandle(nodeId, index % 2 ? ROUTE_STATE_IN : ROUTE_STATE_OUT, index % 2 === 0),
  );
  return Boolean(routeTypes[0] && routeTypes.every((type) => type === routeTypes[0]));
}

function modularVideoEdgeHandles(binding: StudioGraphBinding) {
  return modularVideoLastFrameObserved(binding)
    ? [...MODULAR_VIDEO_I2V_EDGE_HANDLES, ...MODULAR_VIDEO_LAST_FRAME_EDGE_HANDLES]
    : MODULAR_VIDEO_I2V_EDGE_HANDLES;
}

function modularVideoTopology(binding: StudioGraphBinding) {
  if (!modularVideoGroupObserved(binding)) return undefined;
  const roles = modularVideoParticipatingRoles(binding);
  if (!roles.every((role) => binding.nodes[role])) return false;
  const specs = modularVideoEdgeHandles(binding).map((handles) => exactTypedEdgeSpec(binding, handles));
  return modularVideoControlContractComplete(binding) &&
    modularVideoRouteContractComplete(binding) &&
    specs.every(Boolean)
    ? (specs as StudioEdgeSpec[])
    : false;
}

function desiredModularVideoEdgeSpecs(binding: StudioGraphBinding) {
  return modularVideoTopology(binding) || [];
}

function modularTopologyPending(binding: StudioGraphBinding) {
  const modularVideo = modularVideoTopology(binding);
  if (modularVideo !== undefined) return modularVideo === false;
  const inpaintState = modularInpaintStateTopology(binding);
  return (
    inpaintState === false || modularDenoiseVaeTopology(binding) === false || modularRouteTopology(binding) === false
  );
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
  const denoiseVae = modularDenoiseVaeTopology(binding);
  const inpaintState = modularInpaintStateTopology(binding);
  const nativeTopology = inpaintState === false ? false : modularRouteTopology(binding);
  const specs = [
    makeConnectionSpec(qwenQuantization, ['quantization_config'], models, ['quant_config']),
    makeConnectionSpec(models, ['text_encoders'], prompt, ['text_encoders']),
    makeConnectionSpec(models, ['unet_out'], denoise, ['unet']),
    makeConnectionSpec(models, ['scheduler'], denoise, ['scheduler']),
    denoiseVae ? makeConnectionSpec(models, ['vae_out'], denoise, ['vae']) : null,
    makeConnectionSpec(models, ['vae_out'], decode, ['vae']),
    makeConnectionSpec(prompt, ['embeddings'], denoise, ['embeddings']),
    makeConnectionSpec(denoise, ['latents'], decode, ['latents']),
    makeConnectionSpec(decode, ['images', 'image', 'output'], preview, IMAGE_HANDLE),
  ];
  if (nativeTopology) {
    specs.push(makeConnectionSpec(denoise, ROUTE_STATE_OUT, decode, ROUTE_STATE_IN));
    if (nativeTopology & CONTROL_ROUTE) {
      specs.push(makeConnectionSpec(controlnet, ROUTE_STATE_OUT, denoise, ROUTE_STATE_IN));
    }
  }

  if (binding.mode === 'inpaint' && loadImage && loadMask && imageEncode) {
    specs.push(makeConnectionSpec(models, ['vae_out'], imageEncode, ['vae']));
    if (nativeTopology) {
      specs.push(
        makeConnectionSpec(loadImage, IMAGE_HANDLE, imageEncode, IMAGE_HANDLE),
        makeConnectionSpec(loadMask, IMAGE_HANDLE, imageEncode, MASK_IMAGE_HANDLE),
        makeConnectionSpec(loadImage, IMAGE_HANDLE, prompt, IMAGE_HANDLE),
        makeConnectionSpec(imageEncode, IMAGE_LATENTS_OUT, denoise, IMAGE_LATENTS_IN),
        makeConnectionSpec(
          imageEncode,
          ROUTE_STATE_OUT,
          nativeTopology & CONTROL_ROUTE ? controlnet : denoise,
          ROUTE_STATE_IN,
        ),
      );
      if (inpaintState) {
        specs.push(
          makeConnectionSpec(imageEncode, INPAINT_MASK, denoise, INPAINT_MASK),
          makeConnectionSpec(imageEncode, MASKED_IMAGE_LATENTS, denoise, MASKED_IMAGE_LATENTS),
        );
      }
    } else if (inpaintState === undefined && applyMask) {
      specs.push(
        makeConnectionSpec(loadImage, IMAGE_HANDLE, applyMask, IMAGE_HANDLE),
        makeConnectionSpec(loadMask, IMAGE_HANDLE, applyMask, ['mask']),
        makeConnectionSpec(applyMask, ['output'], imageEncode, IMAGE_HANDLE),
        makeConnectionSpec(applyMask, ['output'], prompt, IMAGE_HANDLE),
        makeConnectionSpec(imageEncode, IMAGE_LATENTS_OUT, denoise, IMAGE_LATENTS_IN),
      );
    }
  } else if (loadImage && imageEncode) {
    specs.push(
      makeConnectionSpec(models, ['vae_out'], imageEncode, ['vae']),
      makeConnectionSpec(loadImage, IMAGE_HANDLE, imageEncode, IMAGE_HANDLE),
      makeConnectionSpec(loadImage, IMAGE_HANDLE, prompt, IMAGE_HANDLE),
      makeConnectionSpec(imageEncode, IMAGE_LATENTS_OUT, denoise, IMAGE_LATENTS_IN),
    );
    if (nativeTopology) {
      specs.push(
        makeConnectionSpec(
          imageEncode,
          ROUTE_STATE_OUT,
          nativeTopology & CONTROL_ROUTE ? controlnet : denoise,
          ROUTE_STATE_IN,
        ),
      );
    }
  }

  const controlLoader = controlImageLoader(binding);
  if (controlLoader && controlnetModel && controlnet) {
    specs.push(
      makeConnectionSpec(models, ['vae_out'], controlnet, ['vae']),
      makeConnectionSpec(controlnetModel, ['model'], controlnet, ['controlnet']),
      makeConnectionSpec(controlLoader, IMAGE_HANDLE, controlnet, ['control_image']),
      makeConnectionSpec(controlnet, ['controlnet_bundle'], denoise, ['controlnet_bundle']),
    );
  }

  return specs.filter((spec): spec is StudioEdgeSpec => Boolean(spec));
}

function desiredVideoEdgeSpecs(binding: StudioGraphBinding, includeControlled = true) {
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
  const controlledSequence = includeControlled
    ? useFlowStore.getState().nodes.find((node) => node.data?.studioRole === 'videoSequence')?.id
    : undefined;
  const controlledCompose = includeControlled
    ? useFlowStore.getState().nodes.find((node) => node.data?.studioRole === 'videoCompose')?.id
    : undefined;
  const controlledUpscaler = includeControlled
    ? useFlowStore.getState().nodes.find((node) => node.data?.studioRole === 'upscaler')?.id
    : undefined;
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
      IMAGE_HANDLE,
    ),
    makeConnectionSpec(
      deliverySource,
      controlledUpscaler ? ['output'] : controlledCompose ? ['video'] : ['video_out'],
      videoExport,
      ['video'],
    ),
  ];

  if (loadImage) {
    specs.push(makeConnectionSpec(loadImage, IMAGE_HANDLE, wanGenerate, ['reference_images']));
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
    makeConnectionSpec(loadImage, IMAGE_HANDLE, diffusersImageEdit, IMAGE_HANDLE),
    makeConnectionSpec(loadImage, IMAGE_HANDLE, qwenOutpaintCanvas, IMAGE_HANDLE),
    makeConnectionSpec(qwenOutpaintCanvas, ['canvas'], diffusersImageInpaint, IMAGE_HANDLE),
    makeConnectionSpec(qwenOutpaintCanvas, MASK_IMAGE_HANDLE, diffusersImageInpaint, MASK_IMAGE_HANDLE),
    makeConnectionSpec(qwenOutpaintCanvas ? undefined : loadImage, IMAGE_HANDLE, diffusersImageInpaint, IMAGE_HANDLE),
    makeConnectionSpec(loadMask, IMAGE_HANDLE, diffusersImageInpaint, MASK_IMAGE_HANDLE),
    makeConnectionSpec(loadImage, IMAGE_HANDLE, diffusersImageControl, ['control_image', 'image']),
    makeConnectionSpec(targetNode, ['images', 'image', 'output'], preview, IMAGE_HANDLE),
  ].filter((spec): spec is StudioEdgeSpec => Boolean(spec));
}

function desiredStillUpscaleEdgeSpecs(binding: StudioGraphBinding) {
  const controlledUpscaler = useFlowStore.getState().nodes.find((node) => node.data?.studioRole === 'upscaler')?.id;
  const controlledPreview = useFlowStore
    .getState()
    .nodes.find((node) => node.data?.studioRole === 'upscalePreview')?.id;
  if (!controlledUpscaler || !controlledPreview) return [];

  const source = usesDiffusersImageFacade(binding)
    ? (binding.nodes.diffusersImageInpaint ??
      binding.nodes.diffusersImageControl ??
      binding.nodes.diffusersImageEdit ??
      binding.nodes.diffusersImageGenerate)
    : binding.nodes.decode;

  return [
    makeConnectionSpec(source, ['images', 'image', 'output'], controlledUpscaler, IMAGE_HANDLE),
    makeConnectionSpec(controlledUpscaler, ['output', 'image'], controlledPreview, IMAGE_HANDLE),
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

function desiredExecutionSpecEdgeSpecs(binding: StudioGraphBinding) {
  const spec = executionSpecForBinding(binding);
  if (spec === undefined) return undefined;
  if (spec === null) return [];
  if (
    spec.bindings.some(([role, param]) => {
      const field = getNodeParam(binding.nodes[role], param);
      return !field || field.display === 'output';
    })
  )
    return [];
  const edges = spec.edges.map(([sourceRole, sourceHandle, targetRole, targetHandle]) =>
    makeConnectionSpec(binding.nodes[sourceRole], [sourceHandle], binding.nodes[targetRole], [targetHandle]),
  );
  const expertQuantizationEdge = binding.nodes.qwenQuantization
    ? makeConnectionSpec(binding.nodes.qwenQuantization, ['quantization_config'], binding.nodes.models, [
        'quant_config',
      ])
    : undefined;
  return edges.every(Boolean) && (!binding.nodes.qwenQuantization || expertQuantizationEdge)
    ? ([...edges, ...(expertQuantizationEdge ? [expertQuantizationEdge] : [])] as StudioEdgeSpec[])
    : [];
}

function desiredEdgeSpecs(binding: StudioGraphBinding) {
  const executionSpecEdges = desiredExecutionSpecEdgeSpecs(binding);
  if (executionSpecEdges) return [...executionSpecEdges, ...desiredStillUpscaleEdgeSpecs(binding)];
  if (isAudioMode(binding.mode)) return desiredAudioEdgeSpecs(binding);
  if (modularVideoGroupObserved(binding)) return desiredModularVideoEdgeSpecs(binding);
  if (usesDiffusersImageFacade(binding)) {
    return [...desiredDiffusersImageEdgeSpecs(binding), ...desiredStillUpscaleEdgeSpecs(binding)];
  }
  return isVideoMode(binding.mode)
    ? desiredVideoEdgeSpecs(binding)
    : [...desiredBaseEdgeSpecs(binding), ...desiredStillUpscaleEdgeSpecs(binding)];
}

function baseDesiredEdgeSpecs(binding: StudioGraphBinding) {
  const executionSpecEdges = desiredExecutionSpecEdgeSpecs(binding);
  if (executionSpecEdges) return executionSpecEdges;
  if (isAudioMode(binding.mode)) return desiredAudioEdgeSpecs(binding);
  if (modularVideoGroupObserved(binding)) return desiredModularVideoEdgeSpecs(binding);
  if (usesDiffusersImageFacade(binding)) return desiredDiffusersImageEdgeSpecs(binding);
  return isVideoMode(binding.mode) ? desiredVideoEdgeSpecs(binding, false) : desiredBaseEdgeSpecs(binding);
}

function minimumDynamicManagedEdgeCount(binding: StudioGraphBinding) {
  const modularVideo = modularVideoTopology(binding);
  if (modularVideo !== undefined) {
    return modularVideo ? modularVideo.length : modularVideoEdgeHandles(binding).length;
  }
  // Modular Diffusers starts with seven core links. Dynamic field actions add
  // the concrete handles used by these links, so a smaller restored graph is
  // still a skeleton and must not be treated as finalized.
  const denoiseVae = modularDenoiseVaeTopology(binding);
  const inpaintState = modularInpaintStateTopology(binding);
  const nativeTopology = inpaintState === false ? false : modularRouteTopology(binding);
  let count = 7;
  if (binding.nodes.qwenQuantization) count += 1;
  if (denoiseVae) count += 1;
  if (nativeTopology) count += nativeTopology;

  if (binding.mode === 'inpaint' && binding.nodes.loadImage && binding.nodes.loadMask && binding.nodes.imageEncode) {
    count += 5;
    if (findParamKey(binding.nodes.prompt, IMAGE_HANDLE)) count += 1;
    if (inpaintState) count += 2;
  } else if (binding.nodes.loadImage && binding.nodes.imageEncode) {
    count += 3;
    if (findParamKey(binding.nodes.prompt, IMAGE_HANDLE)) count += 1;
    if (nativeTopology) count += 1;
  }

  if (binding.nodes.controlnetModel && binding.nodes.controlnet) {
    count += 4;
  }

  const controlledRoles = useFlowStore.getState().nodes.map((node) => node.data.studioRole);
  if (controlledRoles.includes('upscaler') && controlledRoles.includes('upscalePreview')) count += 2;
  return count;
}

function nodeHasFieldGroups(nodeId: string | undefined, groups: string[][]) {
  return !!nodeId && groups.every((group) => !!findParamKey(nodeId, group));
}

function legacyDynamicFieldGroupsAreFinalized(binding: StudioGraphBinding) {
  const modularVideo = modularVideoTopology(binding);
  if (modularVideo !== undefined) return modularVideo !== false;
  const inpaintState = modularInpaintStateTopology(binding);
  const topology = modularRouteTopology(binding);
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
  if (topology === false || inpaintState === false || modularDenoiseVaeTopology(binding) === false) return false;
  if (binding.nodes.qwenQuantization) {
    if (!nodeHasFieldGroups(binding.nodes.qwenQuantization, [['model_id'], ['quantization_config']])) return false;
  }
  if (binding.nodes.imageEncode) {
    if (
      !nodeHasFieldGroups(binding.nodes.imageEncode, [IMAGE_HANDLE, IMAGE_LATENTS_OUT]) ||
      !nodeHasFieldGroups(binding.nodes.denoise, [IMAGE_LATENTS_IN])
    ) {
      return false;
    }
    if (binding.mode === 'inpaint') {
      if (
        inpaintState === undefined &&
        topology === undefined &&
        !nodeHasFieldGroups(binding.nodes.applyMask, [IMAGE_HANDLE, ['mask'], ['output']])
      ) {
        return false;
      }
    }
  }
  if (binding.nodes.controlnet) {
    if (
      !nodeHasFieldGroups(binding.nodes.controlnet, [['control_image'], ['controlnet'], ['vae'], ['controlnet_bundle']])
    ) {
      return false;
    }
  }
  if (
    (binding.nodes.loadControlImage && !nodeHasFieldGroups(binding.nodes.loadControlImage, [['file'], IMAGE_HANDLE])) ||
    (binding.nodes.controlnetModel && !nodeHasFieldGroups(binding.nodes.controlnetModel, [['model_id'], ['model']]))
  ) {
    return false;
  }
  return true;
}

function participatingRoleNodesAreValid(binding: StudioGraphBinding, form: StudioFormState) {
  if (
    useFlowStore.getState().nodes.some((node) => {
      const role = node.data.studioRole as StudioGraphRole;
      return (
        binding.managedNodeIds.includes(node.id) &&
        COMBINED_CONTROL_ROLES.includes(role) &&
        binding.nodes[role] !== node.id
      );
    })
  ) {
    return false;
  }
  if (
    modularVideoGroupObserved(binding) &&
    useFlowStore.getState().nodes.some((node) => {
      const role = node.data.studioRole as StudioGraphRole;
      return modularVideoParticipatingRoles(binding).includes(role) && binding.nodes[role] !== node.id;
    })
  ) {
    return false;
  }
  const roles = participatingRoles(form, binding);
  const nodeIds = roles.map((role) => binding.nodes[role]);
  return (
    new Set(nodeIds).size === nodeIds.length &&
    roles.every(
      (role) =>
        nodeMatchesRole(binding.nodes[role], role, binding) && binding.managedNodeIds.includes(binding.nodes[role]!),
    )
  );
}

function participatingNodeSchemasMatchRegistry(binding: StudioGraphBinding, form: StudioFormState) {
  const registry = useNodesStore.getState().nodesRegistry;
  return participatingRoles(form, binding).every((role) => {
    const node = getNode(binding.nodes[role]);
    if (!node) return false;
    return managedParamSchemaMatchesRegistry(node.data.params, registry[graphNodeKey(node)]?.params);
  });
}

function bindingHasExecutableFinalizationShape(binding: StudioGraphBinding, form: StudioFormState) {
  if (!bindingMatchesForm(binding, form) || !participatingRoleNodesAreValid(binding, form)) return false;
  const desiredSpecs = desiredEdgeSpecs(binding);
  const desiredEdgeIds = exactDesiredEdgeIds(binding, desiredSpecs);
  if (
    desiredSpecs.length === 0 ||
    !desiredEdgeIds ||
    binding.managedEdgeIds.length !== desiredEdgeIds.length ||
    !desiredEdgeIds.every((edgeId) => binding.managedEdgeIds.includes(edgeId))
  ) {
    return false;
  }
  return (
    !requiresDynamicGraphChannel(form, binding) ||
    (desiredSpecs.length >= minimumDynamicManagedEdgeCount(binding) && legacyDynamicFieldGroupsAreFinalized(binding))
  );
}

function restoredManagedGraphIsLocallyFinalized(
  binding: StudioGraphBinding,
  form: StudioFormState,
  allowLegacyDynamicProof: boolean,
) {
  const plannedForm = resolveGraphResourceForm(form);
  if (inspectStudioGraphBindingDivergence(binding)) return false;

  if (binding.finalizationProof) {
    return (
      bindingFinalizationProofMatches(binding, plannedForm) && getStudioGraphRunBlockingMessage(plannedForm) === null
    );
  }
  if (
    !allowLegacyDynamicProof ||
    !requiresDynamicGraphChannel(plannedForm, binding) ||
    !bindingHasExecutableFinalizationShape(binding, plannedForm)
  ) {
    return false;
  }

  if (modularVideoGroupObserved(binding)) return modularVideoTopology(binding) !== false;
  return getStudioGraphRunBlockingMessage(plannedForm) === null;
}

function restoreFinalizedGraphState(
  binding: StudioGraphBinding,
  form: StudioFormState,
  previous: StudioGraphFinalizationState | null,
) {
  const allowLegacyDynamicProof =
    !binding.finalizationProof && !binding.finalizationProofInvalid && !binding.controlled;
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
  const managedNodes = new Set(binding.managedNodeIds);
  return useFlowStore
    .getState()
    .edges.filter((edge) => managedNodes.has(edge.source) && managedNodes.has(edge.target))
    .map((edge) => edge.id);
}

function exactDesiredEdgeIds(binding: StudioGraphBinding, specs: StudioEdgeSpec[]) {
  const desiredEdgeIds = collectDesiredEdgeIds(specs);
  return desiredEdgeIds.length === specs.length && desiredEdgeIds.length === collectManagedNodeEdgeIds(binding).length
    ? desiredEdgeIds
    : undefined;
}

function desiredEdgeSpecHash(binding: StudioGraphBinding) {
  return hashGraphProof(
    desiredEdgeSpecs(binding)
      .map((spec) => edgeKey(spec.source, spec.sourceHandle, spec.target, spec.targetHandle))
      .sort(),
  );
}

function reconcileManagedGraphBinding(
  binding: StudioGraphBinding,
  managedExtensionNodeIds: readonly string[] = [],
): StudioGraphBinding {
  const { nodes, edges } = useFlowStore.getState();
  const requestedExtensionIds = new Set(managedExtensionNodeIds);
  const retainedBindingNodeIds = binding.controlled
    ? [
        ...Object.entries(binding.nodes)
          .filter(([role, nodeId]) => role in NODE_KEYS && typeof nodeId === 'string')
          .map(([, nodeId]) => nodeId as string),
        ...nodes
          .filter(
            (node) =>
              node.data.studioOwned === true &&
              typeof node.data.studioRole === 'string' &&
              isControlledRole(node.data.studioRole),
          )
          .map((node) => node.id),
      ]
    : binding.managedNodeIds?.length
      ? binding.managedNodeIds
      : Object.values(binding.nodes).filter(isString);
  const managedNodeIds = Array.from(
    new Set([
      ...retainedBindingNodeIds,
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
      .filter((edge) =>
        binding.controlled
          ? managedNodes.has(edge.source) || managedNodes.has(edge.target)
          : managedNodes.has(edge.source) && managedNodes.has(edge.target),
      )
      .map((edge) => edge.id),
    updatedAt: Date.now(),
  };
}

async function waitForManagedEdges(binding: StudioGraphBinding, timeout = 1500) {
  await waitForValue(() => exactDesiredEdgeIds(binding, desiredEdgeSpecs(binding)) || undefined, timeout);
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
  const studio = useStudioStore.getState();
  const binding = studio.graphBinding;
  if (!binding) return null;
  const refreshed = reconcileManagedGraphBinding(binding, managedExtensionNodeIds);
  const form = resolveGraphResourceForm(studio.form);
  const finalization = studio.graphFinalization;
  let next = refreshed;
  if (
    bindingFinalizationSchemaProofMatches(binding, form) &&
    finalization?.status === 'complete' &&
    bindingHasExecutableFinalizationShape(refreshed, form) &&
    !inspectStudioGraphBindingDivergence(refreshed)
  ) {
    const finalizedAt = Date.now();
    next = bindingWithFinalizationProof(refreshed, form, finalizedAt);
    studio.setGraphFinalization({
      ...finalization,
      finalizedAt,
      managedEdgeCount: next.managedEdgeIds.length,
    });
  }
  studio.setGraphBinding(next);
  return next;
}

function controlledContractFamily(contractId: ControlledGraphContractId) {
  if (contractId.startsWith('lora.')) return 'lora';
  if (contractId.startsWith('upscale.')) return 'upscale';
  if (contractId.startsWith('quality-video.')) return 'quality-video';
  return contractId;
}

function mergeControlledContractIds(
  previous: readonly ControlledGraphContractId[],
  contractId: ControlledGraphContractId,
) {
  const family = controlledContractFamily(contractId);
  const merged: ControlledGraphContractId[] = [
    ...previous.filter((id) => controlledContractFamily(id) !== family),
    contractId,
  ];
  if (contractId.startsWith('quality-video.') && merged.some((id) => id.startsWith('upscale.'))) {
    const converted: ControlledGraphContractId[] = [
      ...merged.filter((id) => !id.startsWith('upscale.')),
      'upscale.quality-loop.v1',
    ];
    return converted.sort();
  }
  return merged.sort();
}

export function beginControlledGraphTransaction(
  context: WorkflowOperationContext,
  contractId: ControlledGraphContractId,
): ControlledGraphTransaction {
  assertWorkflowOperationContext(context);
  if (activeControlledGraphTransaction) throw new Error('Another controlled graph update is already in progress.');
  const studio = useStudioStore.getState();
  const binding = studio.graphBinding;
  const finalization = studio.graphFinalization;
  const form = resolveGraphResourceForm(studio.form);
  if (
    !binding ||
    finalization?.status !== 'complete' ||
    !bindingFinalizationProofMatches(binding, form) ||
    inspectStudioGraphBindingDivergence(binding)
  ) {
    throw new Error('The Studio graph must be fully finalized before adding a controlled workflow block.');
  }
  const flow = useFlowStore.getState();
  if (flow.historyTransaction)
    throw new Error('Finish the current graph edit before adding a controlled workflow block.');
  const transaction: ControlledGraphTransaction = {
    id: nanoid(),
    context,
    contractId,
    binding,
    finalization,
    flow,
  };
  activeControlledGraphTransaction = transaction;
  try {
    flow.beginHistoryTransaction('Update controlled Studio workflow');
    const pendingBinding = { ...binding, finalizationProof: undefined, finalizationProofInvalid: undefined };
    studio.setGraphBinding(pendingBinding);
    studio.setGraphFinalization({
      status: 'pending',
      bindingFingerprint: binding.fingerprint,
      startedAt: Date.now(),
      timedOutGroups: [],
      managedEdgeCount: binding.managedEdgeIds.length,
      message: 'Updating controlled workflow...',
    });
    return transaction;
  } catch (error) {
    abortControlledGraphTransaction(transaction);
    throw error;
  }
}

export function abortControlledGraphTransaction(transaction: ControlledGraphTransaction) {
  if (activeControlledGraphTransaction?.id !== transaction.id) return;
  activeControlledGraphTransaction = null;
  let ownsCanvas = true;
  try {
    assertWorkflowOperationContext(transaction.context);
  } catch {
    ownsCanvas = false;
  }
  if (!ownsCanvas) {
    return;
  }
  useFlowStore.setState(transaction.flow);
  useFlowStore.getState().updateHandleConnectionStatus();
  useFlowStore.getState().updateSignalValues(transaction.flow.edges);
  const studio = useStudioStore.getState();
  studio.setGraphBinding(transaction.binding);
  studio.setGraphFinalization(transaction.finalization);
}

export function commitControlledGraphTransaction(transaction: ControlledGraphTransaction) {
  if (activeControlledGraphTransaction?.id !== transaction.id) {
    throw new Error('Controlled graph update ownership was lost.');
  }
  try {
    assertWorkflowOperationContext(transaction.context);
    const studio = useStudioStore.getState();
    const current = studio.graphBinding;
    if (!current || current.fingerprint !== transaction.binding.fingerprint) {
      throw new Error('The Studio graph changed while the controlled block was being added.');
    }
    const contractIds = mergeControlledContractIds(
      transaction.binding.controlled?.contractIds ?? [],
      transaction.contractId,
    );
    const controlledIds = useFlowStore
      .getState()
      .nodes.filter(
        (node) =>
          node.data.studioOwned === true &&
          typeof node.data.studioRole === 'string' &&
          isControlledRole(node.data.studioRole),
      )
      .map((node) => node.id);
    const declared = {
      ...current,
      controlled: { schemaVersion: 1 as const, contractRevision: 1 as const, contractIds },
      finalizationProof: undefined,
      finalizationProofInvalid: undefined,
    };
    const reconciled = reconcileManagedGraphBinding(declared, controlledIds);
    const form = resolveGraphResourceForm(studio.form);
    if (!controlledGraphSemanticsAreValid(reconciled, form)) {
      throw new Error('The controlled workflow route is incomplete or does not match its reviewed graph contract.');
    }
    const finalizedAt = Date.now();
    const finalized = bindingWithFinalizationProof(reconciled, form, finalizedAt);
    if (finalized.finalizationProof?.schemaVersion !== 3) {
      throw new Error('The controlled workflow proof could not be sealed.');
    }
    useFlowStore.getState().commitHistoryTransaction();
    studio.setGraphBinding(finalized);
    studio.setGraphFinalization({
      status: 'complete',
      bindingFingerprint: finalized.fingerprint,
      startedAt: transaction.finalization.startedAt,
      skeletonMs: transaction.finalization.skeletonMs,
      finalizedAt,
      finalizationMs: 0,
      timedOutGroups: [],
      managedEdgeCount: finalized.managedEdgeIds.length,
      message: 'Controlled workflow finalized.',
    });
    studio.setLastError(null);
    studio.saveActiveWorkflowTab(true);
    activeControlledGraphTransaction = null;
    return finalized;
  } catch (error) {
    abortControlledGraphTransaction(transaction);
    throw error;
  }
}

function scheduleManagedEdgeBindingRefresh(binding: StudioGraphBinding) {
  [0, 50, 150, 400, 900, 1500, 2500].forEach((delayMs) => {
    window.setTimeout(() => refreshManagedEdgeBinding(binding), delayMs);
  });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForValue<T>(read: () => T | undefined, timeout: number, interval = 50) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = read();
    if (value !== undefined) return value;
    await delay(interval);
  }
}

function requiresDynamicGraphChannel(form: StudioFormState, binding?: StudioGraphBinding | null) {
  if (usesStaticHuggingFaceExecutionSpec(form, binding) || (binding && usesDiffusersThreeDFacade(binding)))
    return false;
  return (
    modularVideoGroupObserved(binding) ||
    (!isVideoMode(form.mode) && !isAudioMode(form.mode) && !usesDiffusersImageFacade(form))
  );
}

async function waitForDynamicGraphChannel(timeout = 20_000) {
  if (typeof WebSocket === 'undefined') return true;

  const websocket = useWebsocketStore.getState();
  if (websocket.isConnected && websocket.sid) return true;
  if (!websocket.isConnecting) {
    websocket.connect();
  }

  if (
    await waitForValue(() => {
      const current = useWebsocketStore.getState();
      return current.isConnected && current.sid ? true : undefined;
    }, timeout)
  )
    return true;

  const message = 'The Studio graph could not initialize because the MoDiff connection is not ready.';
  useStudioStore.getState().setLastError(message);
  throw new Error(message);
}

async function waitForFieldGroups(nodeId: string | undefined, groups: string[][], timeout = 4500) {
  if (!nodeId || groups.length === 0) return true;
  return Boolean(
    await waitForValue(
      () => (groups.every((group) => Boolean(findParamKey(nodeId, group))) ? true : undefined),
      timeout,
      100,
    ),
  );
}

async function waitForFieldGroupsTracked(
  nodeId: string | undefined,
  groups: string[][],
  timedOutGroups: string[],
  label: string,
  timeout = 4500,
) {
  const ready = await waitForFieldGroups(nodeId, groups, timeout);
  if (!ready) timedOutGroups.push(label);
  return ready;
}

function missingRegistryRoles(
  form: Pick<StudioFormState, 'modelType' | 'mode'>,
  roles: StudioGraphRole[],
  registry = useNodesStore.getState().nodesRegistry,
  spec?: StudioExecutionSpec | null,
) {
  return roles.filter((role) => !registry[nodeKeyForFormRole(form, role, spec) ?? '']);
}

function executionSpecMatchesRegistry(spec: StudioExecutionSpec, registry = useNodesStore.getState().nodesRegistry) {
  const definitions = Object.fromEntries(spec.roles.map(([role, nodeKey]) => [role, registry[nodeKey]])) as Partial<
    Record<StudioGraphRole, NodeData>
  >;
  return (
    spec.roles.every(
      ([role, nodeKey]) =>
        definitions[role]?.params && `${definitions[role]?.module}.${definitions[role]?.action}` === nodeKey,
    ) &&
    (spec.executionPath === 'modular-diffusers' ||
      (spec.bindings.every(
        ([role, param]) => definitions[role]?.params[param] && definitions[role]?.params[param]?.display !== 'output',
      ) &&
        spec.edges.every(([sourceRole, sourceHandle, targetRole, targetHandle]) => {
          const source = definitions[sourceRole]?.params[sourceHandle];
          const target = definitions[targetRole]?.params[targetHandle];
          return (
            source?.display === 'output' &&
            target?.display === 'input' &&
            connectionTypesAreCompatible(source.type, target.type)
          );
        })))
  );
}

async function ensureRegistryForRoles(
  form: Pick<StudioFormState, 'modelType' | 'mode'>,
  roles: StudioGraphRole[],
  spec?: StudioExecutionSpec | null,
) {
  const nodesStore = useNodesStore.getState();
  let registry = nodesStore.nodesRegistry;
  let missingRoles = missingRegistryRoles(form, roles, registry, spec);

  if (Object.keys(registry).length === 0 || missingRoles.length > 0) {
    await nodesStore.fetchNodes();
    registry = useNodesStore.getState().nodesRegistry;
    missingRoles = missingRegistryRoles(form, roles, registry, spec);
  }

  if (Object.keys(registry).length === 0) {
    const message =
      useNodesStore.getState().error ||
      'MoDiff node registry is not loaded. Check the backend server and try syncing the graph again.';
    useStudioStore.getState().setLastError(message);
    throw new Error(message);
  }
  if (spec && !executionSpecMatchesRegistry(spec, registry)) {
    throw new Error('The Studio execution specification does not match the current node registry.');
  }

  return missingRoles;
}

function ensureNode(
  form: Pick<StudioFormState, 'modelType' | 'mode'>,
  role: StudioGraphRole,
  bindingNodes: Partial<Record<StudioGraphRole, string>>,
  assignedNodeIds: Set<string>,
  spec?: StudioExecutionSpec | null,
) {
  const nodeKey = nodeKeyForFormRole(form, role, spec);
  if (!nodeKey) return undefined;
  const existing = getNode(bindingNodes[role]);
  const existingNode = existing && graphNodeKey(existing) === nodeKey ? existing : undefined;
  if (existingNode && !assignedNodeIds.has(existingNode.id)) {
    assignedNodeIds.add(existingNode.id);
    assignStudioRole(existingNode.id, role, existingNode.data.studioOwned === true);
    return existingNode.id;
  }

  const adoptableNode = useFlowStore
    .getState()
    .nodes.find(
      (node) =>
        !assignedNodeIds.has(node.id) &&
        graphNodeKey(node) === nodeKey &&
        (node.data.studioRole === role || !node.data.studioRole),
    );
  if (adoptableNode) {
    assignedNodeIds.add(adoptableNode.id);
    assignStudioRole(adoptableNode.id, role, Boolean(adoptableNode.data.studioOwned));
    return adoptableNode.id;
  }

  const registryNode = useNodesStore.getState().nodesRegistry[nodeKey];
  if (!registryNode) return undefined;

  const node: CustomNodeType = {
    id: nanoid(),
    type: registryNode.type,
    position: specRole(spec, role)
      ? { x: specRole(spec, role)![2], y: specRole(spec, role)![3] }
      : NODE_POSITIONS[role],
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
  const executionSpec = executionSpecForForm(form);
  if (executionSpec === null) throw new Error('The Studio execution specification does not cover this workflow.');
  const roles = participatingRoles(form, previous);
  const nodes: Partial<Record<StudioGraphRole, string>> = {};
  const assignedNodeIds = new Set<string>();

  roles.forEach((role) => {
    nodes[role] = ensureNode(form, role, previous?.nodes ?? nodes, assignedNodeIds, executionSpec);
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
    ...(executionSpec
      ? {
          executionSpec: {
            schemaVersion: 1 as const,
            id: executionSpec.id,
            contentHash: executionSpec.contentHash,
            executionProfileId: executionSpec.executionProfileId,
          },
        }
      : {}),
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
      'diffusersThreeDPipeline',
    ].includes(role)
  ) {
    return 'Diffusers.LoadPipeline';
  }
  if (['qwenGenerate', 'wanGenerate', 'diffusersImageGenerate'].includes(role)) {
    return 'Diffusers.Generate';
  }
  if (role === 'audioGenerate') return 'Diffusers.GenerateAudio';
  if (role === 'diffusersThreeDGenerate') return 'Diffusers.Generate3D';
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

async function applyAudioPipelineContract(binding: StudioGraphBinding) {
  const pipelineNode = binding.nodes.audioPipeline;
  const generateNode = binding.nodes.audioGenerate;
  const pipelineClassKey = findParamKey(pipelineNode, ['pipeline_class']);
  if (!pipelineNode || !generateNode || !pipelineClassKey) return;

  const pipelineClass = useFlowStore.getState().getParam(pipelineNode, pipelineClassKey, 'value');
  const props = buildFieldProps(pipelineNode, pipelineClassKey);
  if (!props?.onChange) throw new Error('Audio loader contract action missing.');
  await fieldAction(props, pipelineClass);

  const expectedPipelineClass = String(pipelineClass ?? '');
  const expectedMode = String(useFlowStore.getState().getParam(pipelineNode, 'mode', 'value') ?? '');
  const exactContract = (value: unknown) =>
    value &&
    typeof value === 'object' &&
    (value as { pipelineClass?: unknown }).pipelineClass === expectedPipelineClass &&
    (value as { mode?: unknown }).mode === expectedMode
      ? value
      : undefined;
  const value = await waitForValue(() => {
    const signal = useFlowStore.getState().getParam(pipelineNode, 'pipeline', 'signal');
    return exactContract(signal && typeof signal === 'object' ? (signal as { value?: unknown }).value : undefined);
  }, 5000);
  if (!value) throw new Error('Audio task contract timed out.');
  // Stage the exact reviewed contract before invoking the input's declarative
  // value/exec actions. This prevents an older contract from being sampled by
  // the backend action while a workflow switches between audio modes.
  setParamIfPresent(generateNode, ['audio_contract'], value);
  await applyManagedInputSignal(generateNode, ['pipeline'], value);

  const expectedTask = String((value as { taskType?: unknown }).taskType ?? '');
  const accepted = await waitForValue(
    () =>
      useFlowStore.getState().getParam(generateNode, 'task_type', 'value') === expectedTask
        ? exactContract(useFlowStore.getState().getParam(generateNode, 'audio_contract', 'value'))
        : undefined,
    5000,
  );
  if (!accepted) throw new Error('Audio task contract timed out.');
}

async function applyVideoPipelineContract(binding: StudioGraphBinding, mode: StudioMode) {
  const pipelineNode = binding.nodes.wanPipeline;
  const generateNode = binding.nodes.wanGenerate;
  const pipelineClassKey = findParamKey(pipelineNode, ['pipeline_class']);
  if (!pipelineNode || !generateNode || !pipelineClassKey) return;

  const pipelineClass = useFlowStore.getState().getParam(pipelineNode, pipelineClassKey, 'value');
  const props = buildFieldProps(pipelineNode, pipelineClassKey);
  if (!props?.onChange) throw new Error('Video loader contract action missing.');
  await fieldAction(props, pipelineClass);

  const expectedPipelineClass = String(pipelineClass ?? '');
  const exactContract = (value: unknown) =>
    value &&
    typeof value === 'object' &&
    (value as { pipelineClass?: unknown }).pipelineClass === expectedPipelineClass &&
    Array.isArray((value as { modes?: unknown }).modes) &&
    (value as { modes: unknown[] }).modes.includes(mode)
      ? value
      : undefined;
  const value = await waitForValue(() => {
    const signal = useFlowStore.getState().getParam(pipelineNode, 'pipeline', 'signal');
    return exactContract(signal && typeof signal === 'object' ? (signal as { value?: unknown }).value : undefined);
  }, 5000);
  if (!value) throw new Error('Video loader contract timed out.');
  setParamIfPresent(generateNode, ['video_contract'], value);
  await applyManagedInputSignal(generateNode, ['pipeline'], value);

  const modeKey = findParamKey(generateNode, ['mode']);
  const modeProps = modeKey ? buildFieldProps(generateNode, modeKey) : undefined;
  if (!modeKey || !modeProps?.onChange) throw new Error('Video mode contract action missing.');
  useFlowStore.getState().setParam(generateNode, modeKey, mode);
  await fieldAction(modeProps, mode);

  const accepted = await waitForValue(
    () =>
      useFlowStore.getState().getParam(generateNode, 'mode', 'value') === mode
        ? exactContract(useFlowStore.getState().getParam(generateNode, 'video_contract', 'value'))
        : undefined,
    5000,
  );
  if (!accepted) throw new Error('Video generator contract timed out.');
}

async function applyImagePipelineContract(binding: StudioGraphBinding, mode: StudioMode) {
  const pipelineNode = binding.nodes.diffusersImagePipeline;
  const actionNode =
    binding.nodes.diffusersImageInpaint ??
    binding.nodes.diffusersImageControl ??
    binding.nodes.diffusersImageEdit ??
    binding.nodes.diffusersImageGenerate;
  const pipelineClassKey = findParamKey(pipelineNode, ['pipeline_class']);
  if (!pipelineNode || !actionNode || !pipelineClassKey) return;

  const pipelineClass = useFlowStore.getState().getParam(pipelineNode, pipelineClassKey, 'value');
  const props = buildFieldProps(pipelineNode, pipelineClassKey);
  // Older backends and intentionally minimal mocked registries do not expose
  // the declarative contract refresh action. Preserve their existing schema;
  // current backends publish onChange and take the exact path below.
  if (!props?.onChange) return;
  await fieldAction(props, pipelineClass);

  const exactContract = (value: unknown) =>
    value &&
    typeof value === 'object' &&
    (value as { pipelineClass?: unknown }).pipelineClass === pipelineClass &&
    (value as { mode?: unknown }).mode === mode
      ? value
      : undefined;
  const value = await waitForValue(() => {
    const signal = useFlowStore.getState().getParam(pipelineNode, 'pipeline', 'signal');
    return exactContract(signal && typeof signal === 'object' ? (signal as { value?: unknown }).value : undefined);
  }, 5000);
  if (!value) throw new Error('Image task contract timed out.');
  setParamIfPresent(actionNode, ['image_contract'], value);
  await applyManagedInputSignal(actionNode, ['pipeline'], value);
  // The backend action replaces the dynamic field schema and may restore the
  // hidden contract field's class default while doing so. Re-stage the exact
  // loader signal after that schema mutation settles.
  setParamIfPresent(actionNode, ['image_contract'], value);

  const accepted = await waitForValue(
    () => exactContract(useFlowStore.getState().getParam(actionNode, 'image_contract', 'value')),
    5000,
  );
  if (!accepted) {
    const observed = useFlowStore.getState().getParam(actionNode, 'image_contract', 'value');
    throw new Error(
      `Image generator contract timed out for ${String(pipelineClass)}|${mode}; received ${JSON.stringify(observed)}.`,
    );
  }
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
  setModelRepo(controlnetModel, QWEN_CONTROLNET_REQUIREMENT.repo);
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

function applyExpertQuantizationConfig(binding: StudioGraphBinding, form: StudioFormState) {
  const quantizationNode = binding.nodes.qwenQuantization;
  const profile = exactExecutionProfileForForm(form);
  const policy = profile?.expert_quantization_policy;
  if (!quantizationNode || !profile || !policy) return;

  setModelRepo(quantizationNode, profile.default_repo);
  setParamIfPresent(quantizationNode, ['subfolder'], policy.subfolder);
  setParamIfPresent(quantizationNode, ['component'], policy.component);
  setParamIfPresent(quantizationNode, ['quant_type'], policy.quantization_mode);
  setParamIfPresent(quantizationNode, ['bnb_4bit_quant_type'], policy.four_bit_quant_type);
  setParamIfPresent(quantizationNode, ['bnb_4bit_compute_dtype'], policy.compute_dtype);
  setParamIfPresent(quantizationNode, ['bnb_4bit_use_double_quant'], policy.double_quant);
}

function connectBaseGraph(binding: StudioGraphBinding) {
  if (modularTopologyPending(binding)) {
    return collectManagedNodeEdgeIds(binding);
  }
  return reconcileManagedEdges(binding, desiredEdgeSpecs(binding));
}

function managedConnectionsAreReady(binding: StudioGraphBinding) {
  const specs = desiredEdgeSpecs(binding);
  return (
    specs.length >= minimumDynamicManagedEdgeCount(binding) &&
    legacyDynamicFieldGroupsAreFinalized(binding) &&
    collectDesiredEdgeIds(specs).length === specs.length
  );
}

async function reinforceImageConnections(binding: StudioGraphBinding) {
  const { loadImage, loadMask, applyMask, imageEncode, denoise, decode } = binding.nodes;
  if (!loadImage || !imageEncode || !denoise) return true;

  await delay(250);
  if (binding.mode === 'inpaint') {
    let inpaintState = modularInpaintStateTopology(binding);
    if (inpaintState !== undefined) {
      await Promise.all([
        waitForFieldGroups(imageEncode, [MASK_IMAGE_HANDLE, INPAINT_MASK, MASKED_IMAGE_LATENTS, ROUTE_STATE_OUT], 3000),
        waitForFieldGroups(
          denoise,
          [INPAINT_MASK, MASKED_IMAGE_LATENTS, ['vae'], ROUTE_STATE_IN, ROUTE_STATE_OUT],
          3000,
        ),
        waitForFieldGroups(decode, [ROUTE_STATE_IN], 3000),
      ]);
      inpaintState = modularInpaintStateTopology(binding);
    }
    const nativeInpaint = inpaintState === false ? false : modularRouteTopology(binding);
    if (nativeInpaint === false || !loadMask) return false;

    if (nativeInpaint) {
      connectBaseGraph(binding);
      return managedConnectionsAreReady(binding);
    }

    if (!applyMask) return false;
    await waitForFieldGroups(applyMask, [IMAGE_HANDLE, ['mask'], ['output']], 3000);
    await waitForFieldGroups(imageEncode, [IMAGE_HANDLE, IMAGE_LATENTS_OUT], 3000);
    await waitForFieldGroups(denoise, [IMAGE_LATENTS_IN], 3000);
    connectBaseGraph(binding);
    return managedConnectionsAreReady(binding);
  }

  const routeTopology = modularRouteTopology(binding);
  if (routeTopology === false) return false;
  await waitForFieldGroups(imageEncode, [IMAGE_HANDLE, IMAGE_LATENTS_OUT], 3000);
  await waitForFieldGroups(denoise, [IMAGE_LATENTS_IN], 3000);
  connectBaseGraph(binding);
  return managedConnectionsAreReady(binding);
}

async function reinforceControlConnections(binding: StudioGraphBinding) {
  const { models, controlnetModel, controlnet, denoise } = binding.nodes;
  const controlLoader = controlImageLoader(binding);
  if (!models || !controlLoader || !controlnetModel || !controlnet || !denoise) return true;

  await delay(250);
  if (modularTopologyPending(binding)) return false;
  await waitForFieldGroups(controlnetModel, [['model'], ['model_id']], 3000);
  await waitForFieldGroups(controlnet, [['control_image'], ['controlnet'], ['vae'], ['controlnet_bundle']], 5000);
  await waitForFieldGroups(denoise, [['controlnet_bundle']], 3000);
  connectBaseGraph(binding);
  return managedConnectionsAreReady(binding);
}

function applyExecutionSpecValues(binding: StudioGraphBinding, form: StudioFormState, spec: StudioExecutionSpec) {
  const candidate = form.resourceMode === 'auto' ? selectedVisibleGraphAutoCandidate(form, binding) : null;
  if (candidate && candidate.executionProfileId !== spec.executionProfileId) {
    throw new Error('The selected Auto candidate does not match the Studio execution specification.');
  }
  const quantizationMode = form.resourceMode === 'expert' ? form.quantizationMode : 'none';
  const audioTemplateBaseModel = binding.nodes.audioPipeline ? activeAudioTemplateBaseModel() : null;
  const capability = useNodesStore.getState().studioModelCapabilities.find((item) => item.modelType === spec.modelType);
  const bindsDefaultRevision = spec.bindings.some(([, , source]) => source === 'defaultRevision');
  const defaultRevision = capability?.revisionCandidates ?? [];
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
  const values: Record<string, unknown> = {
    ...form,
    quantizationMode,
    quantizedComponents: ['transformer'],
    deviceMapNone: 'none',
    attentionBackend: 'auto',
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
    kind: auxiliaryRequirement?.kind,
    repo: auxiliaryRequirement ? { source: 'hub', value: auxiliaryRequirement.repo } : undefined,
    revision: auxiliaryRequirement?.revision,
    wanVaceRevision: WAN_VACE_REVISION,
    cannyLowThreshold: 0.1,
    cannyHighThreshold: 0.2,
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
    bpmNormalized: form.bpm > 0 ? form.bpm : 0,
    sampleRate16000: 16000,
    sampleRate24000: 24000,
    sampleRate48000: 48000,
    numWaveforms1: 1,
    numWaveforms3: 3,
    referenceWindow15: 15,
    targetPeakMinus1: -1,
    maxAdjustment12: 12,
    boundaryFade001: 0.01,
    lastImage: '',
    poseVideo: '',
    faceVideo: '',
    backgroundVideo: '',
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
    seed: seedValue(form),
  };
  if (binding.nodes.diffusersImagePipeline && !bindsAuxiliaryModel) {
    setParamIfPresent(binding.nodes.diffusersImagePipeline, ['conditioning_kind'], 'none');
    setParamIfPresent(binding.nodes.diffusersImagePipeline, ['conditioning_model_id'], '');
    setParamIfPresent(binding.nodes.diffusersImagePipeline, ['conditioning_revision'], '');
  }
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
  for (const [role, param, source] of spec.bindings) {
    const nodeId = binding.nodes[role];
    if (!nodeId || !(param in (getNode(nodeId)?.data.params ?? {}))) continue;
    if (source === 'artifact') setModelRepo(nodeId, String(values[source]));
    else setParamIfPresent(nodeId, [param], values[source]);
  }
  if (binding.nodes.qwenQuantization) applyExpertQuantizationConfig(binding, form);
}

function applyFormValues(binding: StudioGraphBinding, form: StudioFormState) {
  const {
    models,
    qwenQuantization,
    prompt,
    denoise,
    imageEmbeddings,
    imageEncode,
    loadImage,
    loadControlImage,
    loadMask,
    controlnetModel,
    controlnet,
    qwenOutpaintCanvas,
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
  if (modularVideoGroupObserved(binding)) {
    const executionSpec = executionSpecForBinding(binding);
    if (executionSpec === null) throw new Error('The Studio execution specification receipt is stale.');
    if (executionSpec) applyExecutionSpecValues(binding, form, executionSpec);
    setParamIfPresent(prompt, ['prompt'], form.prompt);
    setParamIfPresent(prompt, ['negative_prompt'], form.negativePrompt);
    setParamIfPresent(loadImage, ['file'], form.referenceImages);
    setParamIfPresent(loadImage, ['alpha_channel'], form.alphaMode);
    // The ending frame remains workflow-local and distinct from this source.
    for (const nodeId of [imageEmbeddings, imageEncode, denoise]) {
      setParamIfPresent(nodeId, ['width'], form.width);
      setParamIfPresent(nodeId, ['height'], form.height);
    }
    for (const nodeId of [imageEncode, denoise]) {
      setParamIfPresent(nodeId, ['num_frames'], form.numFrames);
      setParamIfPresent(nodeId, ['seed'], seedValue(form));
    }
    setParamIfPresent(denoise, ['num_inference_steps', 'steps'], form.steps);
    setParamIfPresent(denoise, ['guidance_scale', 'guidance'], form.guidanceScale);
    setParamIfPresent(videoExport, ['fps'], form.fps);
    return;
  }

  const capability = STUDIO_MODEL_PROFILES[form.modelType];
  const autoCandidate = form.resourceMode === 'auto' ? selectedVisibleGraphAutoCandidate(form, binding) : null;
  const autoPatch = formPatchForAutoCandidate(autoCandidate);
  const executionSpec = executionSpecForBinding(binding);
  if (executionSpec === null) throw new Error('The Studio execution specification receipt is stale.');
  if (executionSpec) {
    applyExecutionSpecValues(binding, form, executionSpec);
    return;
  }
  const executionProfile = executionProfileForForm(form);

  if (isAudioMode(form.mode)) {
    const autoArtifact =
      autoCandidate?.resolvedArtifact ??
      autoCandidate?.artifact ??
      autoCandidate?.installTarget?.repo ??
      autoCandidate?.modelRepo;
    const autoOffloadMode = autoPatch.offloadMode ?? form.offloadMode;
    // Auto candidates resolve to pre-built artifacts. On-load quantization is
    // deliberately restricted to Expert graphs where it remains visible.
    const audioQuantizationMode = form.resourceMode === 'expert' ? form.quantizationMode : 'none';
    const audioDtype = autoPatch.dtype ?? form.dtype;
    const audioPipelineClass = autoCandidate?.pipelineClass ?? executionProfile?.pipeline_class;

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
    if (audioPipelineClass) setParamIfPresent(audioPipeline, ['pipeline_class'], audioPipelineClass);
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
    setParamIfPresent(audioLoudnessMatch, ['reference_window_seconds'], 15);
    setParamIfPresent(audioLoudnessMatch, ['target_peak_dbfs'], -1);
    setParamIfPresent(audioLoudnessMatch, ['max_adjustment_db'], 12);
    setParamIfPresent(audioJoin, ['boundary_fade_seconds'], 0.01);
    setParamIfPresent(audioExport, ['sample_rate'], capability.recommendedSampleRate ?? 48000);
    return;
  }

  if (isVideoMode(form.mode)) {
    const pipelineClass = autoCandidate?.pipelineClass ?? executionProfile?.pipeline_class;
    const resolvedArtifact =
      autoCandidate?.resolvedArtifact ??
      autoCandidate?.artifact ??
      autoCandidate?.installTarget?.repo ??
      autoCandidate?.modelRepo ??
      capability.defaultRepo;
    const resolvedOffloadMode = autoCandidate?.offloadMode ?? form.offloadMode;
    const decodedVideoPixels = form.width * form.height * form.numFrames;
    const needsVaeTiling =
      form.resourceMode !== 'expert' || resolvedOffloadMode !== 'none' || decodedVideoPixels > 40_000_000;
    const supportsNativeFlash = form.device.startsWith('cuda') && autoCandidate?.attentionBackend === '_native_flash';

    setParamIfPresent(
      diffusersQuantization,
      ['backend'],
      form.resourceMode === 'expert' ? form.quantizationMode : 'none',
    );
    setParamIfPresent(diffusersQuantization, ['components'], ['transformer']);
    setParamIfPresent(diffusersQuantization, ['dtype'], autoCandidate?.dtype ?? form.dtype);
    setParamIfPresent(diffusersRecipe, ['device_map'], 'none');
    setParamIfPresent(diffusersRecipe, ['offload_mode'], resolvedOffloadMode);
    setParamIfPresent(diffusersRecipe, ['device'], form.device);
    const attentionBackend = autoCandidate?.attentionBackend ?? 'auto';
    setParamIfPresent(diffusersRecipe, ['attention_backend'], attentionBackend);
    setParamIfPresent(diffusersRecipe, ['attention_components'], supportsNativeFlash ? 'transformer' : '');
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
    if (pipelineClass) setParamIfPresent(wanPipeline, ['pipeline_class'], pipelineClass);
    const artifactRevision = autoCandidate?.artifactRevision ?? autoCandidate?.artifactResolution?.resolved?.revision;
    if (artifactRevision) setParamIfPresent(wanPipeline, ['revision'], artifactRevision);
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
    setParamIfPresent(wanGenerate, ['conditioning_scale'], form.conditioningScale);
    setParamIfPresent(wanGenerate, ['strength'], form.strength);
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
    const autoArtifact =
      autoCandidate?.resolvedArtifact ??
      autoCandidate?.artifact ??
      autoCandidate?.installTarget?.repo ??
      autoCandidate?.modelRepo;
    const autoOffloadMode = autoPatch.offloadMode ?? form.offloadMode;
    const autoQuantizationMode = form.resourceMode === 'expert' ? form.quantizationMode : 'none';
    const targetNode = diffusersImageInpaint ?? diffusersImageControl ?? diffusersImageEdit ?? diffusersImageGenerate;
    const pipelineClass = autoCandidate?.pipelineClass ?? executionProfile?.pipeline_class;
    const imageDtype = autoPatch.dtype ?? form.dtype;

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
    setParamIfPresent(targetNode, ['pag_scale'], form.pagScale);
    setParamIfPresent(targetNode, ['pag_adaptive_scale'], form.pagAdaptiveScale);
    setParamIfPresent(targetNode, ['strength'], form.strength);
    setParamIfPresent(targetNode, ['reference_strength'], form.conditioningScale);
    setParamIfPresent(targetNode, ['output_type'], form.outputType);
    setParamIfPresent(targetNode, ['max_sequence_length'], form.maxSequenceLength);
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
    applyExpertQuantizationConfig(binding, form);
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
  setParamIfPresent(imageEncode, ['width'], form.width);
  setParamIfPresent(imageEncode, ['height'], form.height);
  setParamIfPresent(imageEncode, ['seed'], seedValue(form));

  if (loadImage) {
    const imageValue =
      controlnet && !imageEncode && !loadControlImage
        ? form.controlImage || form.referenceImages[0]
        : form.referenceImages;
    setParamIfPresent(loadImage, ['file'], imageValue);
    // Qwen Image Layered's VAE is RGBA-native. Its public Diffusers contract
    // converts source images to RGBA before encoding; passing the Studio RGB
    // default reaches a 4-channel VAE with only 3 channels.
    setParamIfPresent(loadImage, ['alpha_channel'], form.mode === 'layer_decomposition' ? 'add alpha' : form.alphaMode);
  }

  if (loadControlImage) {
    setParamIfPresent(loadControlImage, ['file'], form.controlImage);
    setParamIfPresent(loadControlImage, ['alpha_channel'], form.alphaMode);
  }

  if (loadMask) {
    setParamIfPresent(loadMask, ['file'], form.maskImage);
    setParamIfPresent(loadMask, ['alpha_channel'], 'remove alpha');
  }

  if (controlnetModel) {
    pinControlnetLoaderIdentity(controlnetModel);
    setModelRepo(controlnetModel, QWEN_CONTROLNET_REQUIREMENT.repo);
    setParamIfPresent(controlnetModel, ['dtype'], form.dtype);
    setParamIfPresent(controlnetModel, ['trust_remote_code'], form.trustRemoteCode);
    setParamIfPresent(controlnetModel, ['device'], form.device);
    setParamIfPresent(controlnetModel, ['auto_offload'], form.autoOffload);
    setParamIfPresent(controlnetModel, ['offload_mode'], form.offloadMode);
  }

  if (controlnet) {
    setParamIfPresent(controlnet, ['width'], form.width);
    setParamIfPresent(controlnet, ['height'], form.height);
    setParamIfPresent(controlnet, ['seed'], seedValue(form));
    setParamIfPresent(controlnet, ['controlnet_conditioning_scale'], form.conditioningScale);
  }
}

export function syncStudioGraphValues(form: StudioFormState = useStudioStore.getState().form) {
  const plannedForm = resolveGraphResourceForm(form);
  const binding = useStudioStore.getState().graphBinding;
  if (!binding) return false;
  syncManagedFormControlAliases(plannedForm, binding);
  applyFormValues(binding, plannedForm);
  return true;
}

function setStudioGraphDefinitionPending(binding: StudioGraphBinding, message: string) {
  const studio = useStudioStore.getState();
  const current = studio.graphFinalization;
  const pendingBinding = {
    ...binding,
    finalizationProof: undefined,
    updatedAt: Date.now(),
  };
  studio.setGraphBinding(pendingBinding);
  studio.setGraphFinalization({
    status: 'pending',
    bindingFingerprint: binding.fingerprint,
    startedAt: current?.startedAt ?? Date.now(),
    skeletonMs: current?.skeletonMs,
    timedOutGroups: [],
    managedEdgeCount: binding.managedEdgeIds.length,
    message,
  });
}

export function markStudioGraphDefinitionPending(nodeId?: string, paramKeys?: readonly (keyof NodeParams)[]) {
  const studio = useStudioStore.getState();
  const binding = studio.graphBinding;
  if (
    !binding ||
    (nodeId && !binding.managedNodeIds.includes(nodeId)) ||
    (paramKeys && !paramKeys.some((key) => GRAPH_PROOF_PARAM_KEYS.includes(key))) ||
    (!binding.controlled && !requiresDynamicGraphChannel(studio.form, binding))
  ) {
    return false;
  }
  if (binding.controlled) {
    const context = captureWorkflowOperationContext();
    const currentHash = controlledGraphHash(binding, binding.controlled.contractIds);
    const pendingHash = controlledDefinitionGraphHashes.get(context.workflowTabId);
    if (pendingHash !== currentHash) {
      if (!bindingFinalizationProofMatches(binding, resolveGraphResourceForm(studio.form))) return false;
      controlledDefinitionGraphHashes.set(context.workflowTabId, currentHash);
    }
  }
  graphDefinitionRevision += 1;
  setStudioGraphDefinitionPending(binding, 'Graph updating.');
  return true;
}

export function syncStudioGraphDefinition(form: StudioFormState = useStudioStore.getState().form) {
  const plannedForm = resolveGraphResourceForm(form);
  const studio = useStudioStore.getState();
  const binding = studio.graphBinding;
  if (!binding) return false;
  if (!bindingMatchesForm(binding, plannedForm)) {
    setStudioGraphDefinitionPending(binding, 'Graph changed.');
    return false;
  }
  syncManagedFormControlAliases(plannedForm, binding);
  applyFormValues(binding, plannedForm);
  if (binding.controlled) {
    const context = captureWorkflowOperationContext();
    const pendingHash = controlledDefinitionGraphHashes.get(context.workflowTabId);
    if (binding.finalizationProofInvalid || !pendingHash) {
      setStudioGraphDefinitionPending(binding, 'Graph pending.');
      return false;
    }
    const updatedBinding = reconcileManagedGraphBinding({
      ...binding,
      finalizationProof: undefined,
      finalizationProofInvalid: undefined,
    });
    if (
      controlledGraphHash(updatedBinding, updatedBinding.controlled?.contractIds ?? []) !== pendingHash ||
      !controlledGraphSemanticsAreValid(updatedBinding, plannedForm)
    ) {
      setStudioGraphDefinitionPending(updatedBinding, 'Graph pending.');
      return false;
    }
    const finalizedAt = Date.now();
    const finalized = bindingWithFinalizationProof(updatedBinding, plannedForm, finalizedAt);
    studio.setGraphBinding(finalized);
    studio.setGraphFinalization({
      status: 'complete',
      bindingFingerprint: finalized.fingerprint,
      startedAt: studio.graphFinalization?.startedAt ?? finalizedAt,
      skeletonMs: studio.graphFinalization?.skeletonMs,
      finalizedAt,
      finalizationMs: 0,
      timedOutGroups: [],
      managedEdgeCount: finalized.managedEdgeIds.length,
      message: 'Controlled workflow finalized.',
    });
    studio.saveActiveWorkflowTab(true);
    controlledDefinitionGraphHashes.delete(context.workflowTabId);
    return true;
  }
  if (!requiresDynamicGraphChannel(plannedForm, binding)) {
    // Static execution-spec graphs can still receive a newer reviewed node
    // schema after registry refresh. Re-seal the unchanged graph against that
    // schema; otherwise its old proof remains stale even though no node or edge
    // topology needs rebuilding.
    if (!participatingNodeSchemasMatchRegistry(binding, plannedForm)) {
      setStudioGraphDefinitionPending(binding, 'Graph changed.');
      return false;
    }
    const finalizedAt = Date.now();
    const updatedBinding = reconcileManagedGraphBinding({
      ...binding,
      finalizationProof: undefined,
      finalizationProofInvalid: undefined,
    });
    const finalized = bindingWithFinalizationProof(updatedBinding, plannedForm, finalizedAt);
    if (!finalized.finalizationProof) {
      setStudioGraphDefinitionPending(updatedBinding, 'Graph changed.');
      return false;
    }
    studio.setGraphBinding(finalized);
    studio.setGraphFinalization({
      status: 'complete',
      bindingFingerprint: finalized.fingerprint,
      startedAt: studio.graphFinalization?.startedAt ?? finalizedAt,
      skeletonMs: studio.graphFinalization?.skeletonMs,
      finalizedAt,
      finalizationMs: 0,
      timedOutGroups: [],
      managedEdgeCount: finalized.managedEdgeIds.length,
      message: 'Static workflow schema revalidated.',
    });
    studio.saveActiveWorkflowTab(true);
    return true;
  }
  if (modularTopologyPending(binding)) {
    setStudioGraphDefinitionPending(binding, 'Route pending.');
    return false;
  }

  connectBaseGraph(binding);
  const updatedBinding = reconcileManagedGraphBinding({
    ...binding,
    finalizationProof: undefined,
  });
  studio.setGraphBinding(updatedBinding);
  if (restoreFinalizedGraphState(updatedBinding, plannedForm, studio.graphFinalization)) return true;
  setStudioGraphDefinitionPending(updatedBinding, 'Graph pending.');
  return false;
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

function graphFinalizationOwnerIsCurrent(token: number, definitionRevision = graphDefinitionRevision) {
  return (
    token === graphFinalizationToken &&
    definitionRevision === graphDefinitionRevision &&
    graphFinalizationContext !== null &&
    workflowOperationContextIsCurrentForGraph(graphFinalizationContext)
  );
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
      binding.nodes.diffusersImagePipeline,
      [['pipeline'], ['model_id']],
      timedOutGroups,
      'diffusers image pipeline',
      5000,
    ),
    waitForFieldGroupsTracked(
      targetNode,
      [['pipeline'], ['prompt'], ['images']],
      timedOutGroups,
      'diffusers image generate',
      5000,
    ),
    binding.nodes.loadImage
      ? waitForFieldGroupsTracked(
          binding.nodes.loadImage,
          [IMAGE_HANDLE, ['file']],
          timedOutGroups,
          'source image loader',
          3000,
        )
      : Promise.resolve(true),
    binding.nodes.loadMask
      ? waitForFieldGroupsTracked(
          binding.nodes.loadMask,
          [IMAGE_HANDLE, ['file']],
          timedOutGroups,
          'mask image loader',
          3000,
        )
      : Promise.resolve(true),
  ]);
  assertGraphFinalizationActive(token);
  applyFormValues(binding, form);
  await applyImagePipelineContract(binding, form.mode);
  assertGraphFinalizationActive(token);
  applyFormValues(binding, form);
  connectBaseGraph(binding);
}

async function finalizeStaticExecutionSpecGraph(binding: StudioGraphBinding, form: StudioFormState, token: number) {
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
      binding.nodes.audioPipeline,
      [['pipeline'], ['model_id']],
      timedOutGroups,
      'diffusers audio pipeline',
      5000,
    ),
    waitForFieldGroupsTracked(
      binding.nodes.audioGenerate,
      [['pipeline'], ['audio']],
      timedOutGroups,
      'diffusers audio generate',
      5000,
    ),
    waitForFieldGroupsTracked(binding.nodes.audioExport, [['audio'], ['file']], timedOutGroups, 'audio export', 5000),
    binding.nodes.audioLoudnessMatch
      ? waitForFieldGroupsTracked(
          binding.nodes.audioLoudnessMatch,
          [['audio'], ['reference'], ['output']],
          timedOutGroups,
          'audio loudness match',
          5000,
        )
      : Promise.resolve(true),
    binding.nodes.audioJoin
      ? waitForFieldGroupsTracked(
          binding.nodes.audioJoin,
          [['source'], ['continuation'], ['output']],
          timedOutGroups,
          'audio join',
          5000,
        )
      : Promise.resolve(true),
    binding.nodes.loadAudio
      ? waitForFieldGroupsTracked(
          binding.nodes.loadAudio,
          [['audio'], ['file']],
          timedOutGroups,
          'source audio loader',
          3000,
        )
      : Promise.resolve(true),
  ]);
  assertGraphFinalizationActive(token);
  applyFormValues(binding, form);
  await applyAudioPipelineContract(binding);
  assertGraphFinalizationActive(token);
  connectBaseGraph(binding);
}

async function finalizeVideoGraph(
  binding: StudioGraphBinding,
  form: StudioFormState,
  timedOutGroups: string[],
  token: number,
) {
  await Promise.all([
    waitForFieldGroupsTracked(
      binding.nodes.wanPipeline,
      [['pipeline'], ['model_id'], ['pipeline_class']],
      timedOutGroups,
      'diffusers video pipeline',
      5000,
    ),
    waitForFieldGroupsTracked(
      binding.nodes.wanGenerate,
      [['pipeline'], ['video_out'], ['mode']],
      timedOutGroups,
      'diffusers video generate',
      5000,
    ),
    binding.nodes.loadImage
      ? waitForFieldGroupsTracked(
          binding.nodes.loadImage,
          [IMAGE_HANDLE, ['file']],
          timedOutGroups,
          'source image loader',
          3000,
        )
      : Promise.resolve(true),
    binding.nodes.loadVideo
      ? waitForFieldGroupsTracked(
          binding.nodes.loadVideo,
          [['video'], ['file']],
          timedOutGroups,
          'source video loader',
          3000,
        )
      : Promise.resolve(true),
    binding.nodes.loadControlVideo
      ? waitForFieldGroupsTracked(
          binding.nodes.loadControlVideo,
          [['video'], ['file']],
          timedOutGroups,
          'control video loader',
          3000,
        )
      : Promise.resolve(true),
    binding.nodes.loadMaskVideo
      ? waitForFieldGroupsTracked(
          binding.nodes.loadMaskVideo,
          [['video'], ['file']],
          timedOutGroups,
          'mask video loader',
          3000,
        )
      : Promise.resolve(true),
  ]);
  assertGraphFinalizationActive(token);
  applyFormValues(binding, form);
  await applyVideoPipelineContract(binding, form.mode);
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
          binding.nodes.qwenQuantization,
          [['model_id'], ['quantization_config']],
          timedOutGroups,
          'qwen quantization config',
          5000,
        )
      : Promise.resolve(true),
    waitForFieldGroupsTracked(
      binding.nodes.prompt,
      [['prompt'], ['embeddings']],
      timedOutGroups,
      'prompt embeddings',
      5000,
    ),
    waitForFieldGroupsTracked(binding.nodes.denoise, denoiseGroups, timedOutGroups, 'denoise inputs', 5000),
    waitForFieldGroupsTracked(binding.nodes.decode, [['latents'], ['images']], timedOutGroups, 'decode inputs', 5000),
    binding.nodes.imageEncode
      ? waitForFieldGroupsTracked(
          binding.nodes.imageEncode,
          [IMAGE_HANDLE, IMAGE_LATENTS_OUT],
          timedOutGroups,
          'image encoder inputs',
          5000,
        )
      : Promise.resolve(true),
    binding.nodes.controlnet
      ? waitForFieldGroupsTracked(
          binding.nodes.controlnet,
          [['control_image'], ['controlnet'], ['vae'], ['controlnet_bundle']],
          timedOutGroups,
          'controlnet inputs',
          5000,
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
  // Dynamic action schemas may declare generic cross-node/form bindings. The
  // backend definition is authoritative, so synchronize only after all
  // Modular node-definition signals have settled.
  syncManagedFormControlAliases(form, binding);
  // Explicit execution-spec bindings and reviewed per-mode constants are the
  // final authority when a generic form alias targets the same field.
  applyFormValues(binding, form);
  connectBaseGraph(binding);
  pinControlnetLoaderIdentity(binding.nodes.controlnetModel);
}

async function finalizeModularVideoGraph(
  binding: StudioGraphBinding,
  form: StudioFormState,
  timedOutGroups: string[],
  token: number,
) {
  await applyModelType(binding, form.modelType, true);
  assertGraphFinalizationActive(token);
  await applyManagedInputSignal(binding.nodes.prompt, ['text_encoders'], form.modelType);
  await applyManagedInputSignal(binding.nodes.imageEmbeddings, ['image_encoder'], form.modelType);
  await applyManagedInputSignal(binding.nodes.imageEncode, ['vae'], form.modelType);
  await applyManagedInputSignal(binding.nodes.denoise, ['unet'], form.modelType);
  await applyManagedInputSignal(binding.nodes.decode, ['vae'], form.modelType);
  assertGraphFinalizationActive(token);
  const started = Date.now();
  while (!modularVideoTopology(binding) && Date.now() - started < 5000) await delay(100);
  if (!modularVideoTopology(binding)) timedOutGroups.push('video route');
  assertGraphFinalizationActive(token);
  syncManagedFormControlAliases(form, binding);
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
  let definitionRevision = graphDefinitionRevision;
  const timedOutGroups: string[] = [];
  const warnings: string[] = [];
  if (binding.finalizationProofInvalid) {
    throw new Error('The saved Studio graph proof is invalid. Recreate the managed graph before running it.');
  }
  if (!bindingMatchesForm(binding, form)) {
    assertGraphFinalizationActive(token);
    return { binding, warnings };
  }
  try {
    if (binding.controlled) {
      assertGraphFinalizationActive(token);
      syncStudioGraphDefinition(form);
      return { binding: useStudioStore.getState().graphBinding ?? binding, warnings };
    }
    if (isAudioMode(form.mode)) {
      await finalizeAudioGraph(binding, form, timedOutGroups, token);
    } else if (modularVideoGroupObserved(binding)) {
      await finalizeModularVideoGraph(binding, form, timedOutGroups, token);
      // Modular signals intentionally publish newer node definitions while
      // assembling the route. Use their settled schema as this operation's
      // baseline; static paths retain their starting revision.
      definitionRevision = graphDefinitionRevision;
    } else if (usesDiffusersImageFacade(form)) {
      await finalizeDiffusersImageGraph(binding, form, timedOutGroups, token);
    } else if (usesStaticHuggingFaceExecutionSpec(form, binding) || usesDiffusersThreeDFacade(binding)) {
      await finalizeStaticExecutionSpecGraph(binding, form, token);
    } else if (!isVideoMode(form.mode)) {
      await finalizeModularGraph(binding, form, timedOutGroups, token);
      definitionRevision = graphDefinitionRevision;
    } else {
      await finalizeVideoGraph(binding, form, timedOutGroups, token);
    }

    assertGraphFinalizationActive(token);
    await waitForManagedEdges(binding, 750);
    assertGraphFinalizationActive(token);
    const currentBinding = useStudioStore.getState().graphBinding;
    // Controlled template blocks can be added while this background finalizer
    // waits for dynamic fields. Reconcile from the current binding when it is
    // still the same managed graph so those already-adopted Studio extensions
    // are not dropped by this older core-binding snapshot.
    const reconciliationBinding = currentBinding?.fingerprint === binding.fingerprint ? currentBinding : binding;
    const updatedBinding = reconcileManagedGraphBinding(reconciliationBinding);
    const routePending = modularTopologyPending(updatedBinding);
    const definitionPending = routePending || !bindingHasExecutableFinalizationShape(updatedBinding, form);
    if (definitionPending) timedOutGroups.push(routePending ? 'route definition' : 'graph definition');
    const finalizedAt = Date.now();
    const finalizedBinding =
      timedOutGroups.length === 0
        ? bindingWithFinalizationProof(updatedBinding, form, finalizedAt)
        : { ...updatedBinding, finalizationProof: undefined, updatedAt: finalizedAt };

    if (graphFinalizationOwnerIsCurrent(token, definitionRevision)) {
      useStudioStore.getState().setGraphBinding(finalizedBinding);
      scheduleManagedEdgeBindingRefresh(finalizedBinding);
      if (!definitionPending) useStudioStore.getState().saveActiveWorkflowTab(true);
      const message = definitionPending
        ? routePending
          ? 'Route pending.'
          : 'Graph pending.'
        : timedOutGroups.length > 0
          ? `Some graph fields are still finalizing: ${timedOutGroups.join(', ')}. Try syncing the graph if Run stays unavailable.`
          : 'Graph finalized.';
      useStudioStore.getState().setGraphFinalization({
        status: definitionPending ? 'pending' : timedOutGroups.length > 0 ? 'warning' : 'complete',
        bindingFingerprint: finalizedBinding.fingerprint,
        startedAt,
        skeletonMs,
        finalizedAt,
        finalizationMs: finalizedAt - startedAt,
        timedOutGroups,
        managedEdgeCount: updatedBinding.managedEdgeIds.length,
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
    if (graphFinalizationOwnerIsCurrent(token, definitionRevision)) {
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
  if (useStudioStore.getState().graphBinding?.finalizationProofInvalid) {
    throw new Error('The saved Studio graph proof is invalid. Recreate the managed graph before updating it.');
  }
  const skeletonStartedAt = Date.now();
  const form = resolveGraphResourceForm(formInput);
  const existingStudio = useStudioStore.getState();
  const existingBinding = existingStudio.graphBinding;
  if (existingBinding?.controlled) {
    if (
      bindingFinalizationProofMatches(existingBinding, form) &&
      !inspectStudioGraphBindingDivergence(existingBinding)
    ) {
      if (existingStudio.graphFinalization?.status !== 'complete') {
        restoreFinalizedGraphState(existingBinding, form, existingStudio.graphFinalization);
      }
      return { binding: useStudioStore.getState().graphBinding ?? existingBinding, warnings: [] };
    }
    if (syncStudioGraphDefinition(form)) {
      return { binding: useStudioStore.getState().graphBinding ?? existingBinding, warnings: [] };
    }
    throw new Error('The controlled Studio graph changed. Recreate it before adding another workflow block.');
  }
  const roles = participatingRoles(form, useStudioStore.getState().graphBinding);
  const executionSpec = executionSpecForForm(form);
  if (executionSpec === null) throw new Error('The Studio execution specification does not cover this workflow.');
  const missingRoles = await ensureRegistryForRoles(form, roles, executionSpec);
  assertWorkflowOperationContext(context);
  if (missingRoles.length > 0) {
    const message = missingRoles.includes('qwenQuantization')
      ? `This Expert quantization recipe needs the MoDiff backend to expose ${expertQuantizationPolicyForForm(form)?.modular_node}. Restart or update the backend with the reviewed quantization node.`
      : `Missing MoDiff node registry entries: ${missingRoles
          .map((role) => nodeKeyForFormRole(form, role, executionSpec))
          .join(', ')}`;
    useStudioStore.getState().setLastError(message);
    throw new Error(message);
  }

  if (requiresDynamicGraphChannel(form, useStudioStore.getState().graphBinding)) {
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
  const waitStartedAt = Date.now();
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
    if (studio.graphBinding?.finalizationProofInvalid) return false;
    if (studio.graphBinding && !bindingMatchesForm(studio.graphBinding, resolveGraphResourceForm(studio.form))) {
      return false;
    }
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
      if (studio.graphBinding.controlled) {
        if (
          bindingFinalizationProofMatches(studio.graphBinding, resolveGraphResourceForm(studio.form)) &&
          restoreFinalizedGraphState(studio.graphBinding, studio.form, finalization)
        ) {
          return true;
        }
        return syncStudioGraphDefinition(studio.form);
      }
      scheduleStudioGraphFinalization(studio.graphBinding, studio.form, finalization.skeletonMs ?? 0, context);
      return waitForStudioGraphFinalization(timeout, context);
    }
    if (!finalization && studio.graphBinding) {
      if (studio.graphBinding.controlled) return syncStudioGraphDefinition(studio.form);
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
  const remainingTimeout = timeout - (Date.now() - waitStartedAt);
  if (remainingTimeout <= 0) return false;
  if (graphFinalizationPromise === promise) graphFinalizationPromise = null;
  return waitForStudioGraphFinalization(remainingTimeout, context);
}

export async function waitForStudioGraphDefinitionStability(
  quietPeriod = 750,
  timeout = 5000,
  context: WorkflowOperationContext = captureWorkflowOperationContext(),
) {
  const startedAt = Date.now();
  let observedRevision = graphDefinitionRevision;
  let stableSince = startedAt;

  while (Date.now() - startedAt <= timeout) {
    assertWorkflowOperationContext(context);
    const studio = useStudioStore.getState();
    const binding = studio.graphBinding;
    if (!binding) return false;
    const form = resolveGraphResourceForm(studio.form);
    if (!requiresDynamicGraphChannel(form, binding)) return true;

    const revisionChanged = observedRevision !== graphDefinitionRevision;
    const finalized =
      studio.graphFinalization?.status === 'complete' &&
      bindingFinalizationProofMatches(binding, form) &&
      !inspectStudioGraphBindingDivergence(binding);
    if (revisionChanged || !finalized) {
      observedRevision = graphDefinitionRevision;
      stableSince = Date.now();
      if (!binding.controlled && bindingMatchesForm(binding, form) && !inspectStudioGraphBindingDivergence(binding)) {
        syncStudioGraphDefinition(form);
      }
    } else if (Date.now() - stableSince >= quietPeriod) {
      return true;
    }

    await delay(Math.min(80, Math.max(1, timeout - (Date.now() - startedAt))));
  }
  return false;
}

export function getStudioGraphRunBlockingMessage(form: StudioFormState = useStudioStore.getState().form) {
  const plannedForm = resolveGraphResourceForm(form);
  const binding = useStudioStore.getState().graphBinding;
  if (binding && !bindingMatchesForm(binding, plannedForm)) return 'Graph changed.';
  if (binding?.finalizationProofInvalid || (binding?.controlled && !binding.finalizationProof)) return 'Graph changed.';
  if (binding?.finalizationProof && !bindingFinalizationProofMatches(binding, plannedForm)) {
    return 'Graph changed.';
  }
  if (binding && modularVideoGroupObserved(binding)) {
    if (modularVideoTopology(binding) === false || !binding.finalizationProof) return 'Route pending.';
    if (!participatingRoleNodesAreValid(binding, plannedForm)) return 'Graph changed.';
    return null;
  }
  if (
    (!binding?.nodes.models && exactExecutionProfileForForm(plannedForm)?.execution_path !== 'modular-diffusers') ||
    isVideoMode(plannedForm.mode) ||
    usesDiffusersImageFacade(plannedForm)
  ) {
    return null;
  }

  if (!binding) {
    return 'Qwen graph is not created yet. Create the graph before running.';
  }
  if (modularTopologyPending(binding)) return 'Route pending.';
  if (!participatingRoleNodesAreValid(binding, plannedForm)) return 'Graph changed.';
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

setManagedGraphSchemaMutationHandler(
  (nodeId, paramKeys) =>
    useStudioStore.getState().graphBinding?.controlled ? markStudioGraphDefinitionPending(nodeId, paramKeys) : false,
  () => syncStudioGraphDefinition(),
);

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
