import { nanoid } from 'nanoid';
import { enqueueSnackbar } from '../ui/snackbar';
import { useFlowStore, type CustomNodeType } from '../stores/useFlowStore';
import { type NodeData, type NodeParams, useNodesStore } from '../stores/useNodeStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import {
  assertWorkflowOperationContext,
  captureWorkflowOperationContext,
  useStudioStore,
  type WorkflowOperationContext,
} from '../stores/useStudioStore';
import { createOrUpdateStudioGraph, refreshStudioManagedGraphBinding } from './graphBridge';
import { resolveStudioResourceForm } from './resourcePlanner';
import type {
  StudioAudioFitSettings,
  StudioFormState,
  StudioTemplateLoraSettings,
  StudioTemplateWorkflowBlockSettings,
} from './types';

export const CONTROLLED_WORKFLOW_NODE_KEYS = {
  lora: 'modules.ModularDiffusers.Lora',
  directLora: 'modules.DiffusersImage.LoadAdapter',
  audioLora: 'modules.DiffusersAudio.LoadAdapter',
  upscaler: 'modules.Spandrel.Upscaler',
  preview: 'modules.Image.Preview',
  videoSequence: 'modules.DiffusersVideo.GenerateSequence',
  videoCompose: 'modules.Video.Compose',
  lyricOverlay: 'modules.Video.LyricOverlay',
  exportWithAudio: 'modules.Video.ExportWithAudio',
  soundtrackQuantization: 'modules.DiffusersRuntime.PipelineQuantizationConfigV2',
  soundtrackRecipe: 'modules.DiffusersRuntime.DiffusersExecutionRecipe',
  soundtrackPipeline: 'modules.DiffusersAudio.LoadPipeline',
  soundtrackGenerate: 'modules.DiffusersAudio.Generate',
  audioFit: 'modules.Audio.FitDuration',
  videoPipeline: 'modules.DiffusersVideo.LoadPipeline',
  lyricVideoQuantization: 'modules.DiffusersRuntime.PipelineQuantizationConfigV2',
  lyricVideoRecipe: 'modules.DiffusersRuntime.DiffusersExecutionRecipe',
  qualityVideoQuantization: 'modules.DiffusersRuntime.PipelineQuantizationConfigV2',
  qualityVideoRecipe: 'modules.DiffusersRuntime.DiffusersExecutionRecipe',
  qualityVideoShots: 'modules.WorkflowControl.AuthorShotList',
  qualityVideoJobs: 'modules.DiffusersVideo.BuildShotJobs',
  qualityVideoLoopItems: 'modules.WorkflowControl.LoopItems',
  qualityVideoGenerate: 'modules.DiffusersVideo.GenerateShotJob',
  qualityVideoRetain: 'modules.Video.ExportAsset',
  qualityVideoLoopResult: 'modules.WorkflowControl.LoopResult',
  qualityVideoJoin: 'modules.Video.ConcatenateAssets',
} as const;

type ControlledNodeRole =
  | 'loraAdapter'
  | `loraAdapter:${string}`
  | 'upscaler'
  | 'upscalePreview'
  | 'videoSequence'
  | 'videoCompose'
  | 'lyricOverlay'
  | 'exportWithAudio'
  | 'soundtrackQuantization'
  | 'soundtrackRecipe'
  | 'soundtrackPipeline'
  | 'soundtrackGenerate'
  | 'soundtrackAudioFit'
  | 'lyricAudioFit'
  | 'lyricVideoPipeline'
  | 'lyricVideoQuantization'
  | 'lyricVideoRecipe'
  | 'qualityVideoQuantization'
  | 'qualityVideoRecipe'
  | 'qualityVideoShots'
  | 'qualityVideoJobs'
  | 'qualityVideoLoopItems'
  | 'qualityVideoGenerate'
  | 'qualityVideoRetain'
  | 'qualityVideoLoopResult'
  | 'qualityVideoJoin';

type ControlledWorkflowOptions = {
  notify?: boolean;
  workflowContext?: WorkflowOperationContext;
};

const VIDEO_DELIVERY_UPSCALER = {
  model: { source: 'hub' as const, value: 'nateraw/real-esrgan/RealESRGAN_x2plus.pth' },
  downscale: 1,
};

function cloneNodeData(data: NodeData): NodeData {
  return JSON.parse(JSON.stringify(data)) as NodeData;
}

function splitNodeKey(key: string) {
  const lastDot = key.lastIndexOf('.');
  return {
    module: key.slice(0, lastDot),
    action: key.slice(lastDot + 1),
  };
}

function graphNodeKey(node: CustomNodeType) {
  return `${node.data.module}.${node.data.action}`;
}

function getNode(nodeId: string | undefined) {
  if (!nodeId) return undefined;
  return useFlowStore.getState().nodes.find((node) => node.id === nodeId);
}

function findParamKey(nodeId: string | undefined, candidates: string[]) {
  const node = getNode(nodeId);
  if (!node) return undefined;
  return candidates.find((candidate) => node.data.params[candidate]);
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

function applyAudioFitValues(nodeId: string, settings: StudioAudioFitSettings) {
  setParamIfPresent(nodeId, ['source_start_seconds'], settings.sourceStartSeconds);
  setParamIfPresent(nodeId, ['source_duration_seconds'], settings.sourceDurationSeconds);
  setParamIfPresent(nodeId, ['target_duration_seconds'], settings.targetDurationSeconds);
  setParamIfPresent(nodeId, ['delay_seconds'], settings.delaySeconds ?? 0);
  setParamIfPresent(nodeId, ['target_sample_rate'], settings.targetSampleRate ?? 48000);
  setParamIfPresent(nodeId, ['fade_in_seconds'], settings.fadeInSeconds ?? 0);
  setParamIfPresent(nodeId, ['fade_out_seconds'], settings.fadeOutSeconds ?? 0);
}

async function ensureRegistryKeys(keys: string[]) {
  const nodesStore = useNodesStore.getState();
  const missingBeforeFetch = keys.filter((key) => !nodesStore.nodesRegistry[key]);
  if (Object.keys(nodesStore.nodesRegistry).length === 0 || missingBeforeFetch.length > 0) {
    await nodesStore.fetchNodes();
  }

  return keys.filter((key) => !useNodesStore.getState().nodesRegistry[key]);
}

function findControlledNode(key: string, role: ControlledNodeRole) {
  return useFlowStore.getState().nodes.find((node) => graphNodeKey(node) === key && node.data.studioRole === role);
}

function ensureControlledNode(key: string, role: ControlledNodeRole, position: { x: number; y: number }) {
  const incompatibleRoleNodes = useFlowStore
    .getState()
    .nodes.filter((node) => node.data.studioRole === role && graphNodeKey(node) !== key)
    .map((node) => node.id);
  if (incompatibleRoleNodes.length > 0) {
    useFlowStore.getState().removeNodes(incompatibleRoleNodes);
  }

  const existing = findControlledNode(key, role);
  if (existing) {
    if (!existing.data.studioOwned) {
      useFlowStore.setState((state) => ({
        nodes: state.nodes.map((node) =>
          node.id === existing.id ? { ...node, data: { ...node.data, studioOwned: true } } : node,
        ),
      }));
    }
    refreshStudioManagedGraphBinding([existing.id]);
    return existing.id;
  }

  const registryNode = useNodesStore.getState().nodesRegistry[key];
  if (!registryNode) {
    throw new Error(`Missing MoDiff node registry entry: ${key}`);
  }

  const fallback = splitNodeKey(key);
  const node: CustomNodeType = {
    id: nanoid(),
    type: registryNode.type,
    position,
    data: {
      ...cloneNodeData(registryNode),
      module: registryNode.module || fallback.module,
      action: registryNode.action || fallback.action,
      studioRole: role,
      studioOwned: true,
    },
  };
  useFlowStore.getState().addNode(node);
  refreshStudioManagedGraphBinding([node.id]);
  return node.id;
}

function ensureConnection(
  source: string | undefined,
  sourceHandles: string[],
  target: string | undefined,
  targetHandles: string[],
) {
  if (!source || !target) return false;
  const sourceHandle = findParamKey(source, sourceHandles);
  const targetHandle = findParamKey(target, targetHandles);
  if (!sourceHandle || !targetHandle) return false;

  const flow = useFlowStore.getState();
  const exists = flow.edges.some(
    (edge) =>
      edge.source === source &&
      edge.target === target &&
      edge.sourceHandle === sourceHandle &&
      edge.targetHandle === targetHandle,
  );
  if (exists) {
    refreshStudioManagedGraphBinding();
    return true;
  }

  flow.onConnect({
    source,
    sourceHandle,
    target,
    targetHandle,
    edgeType: useSettingsStore.getState().edgeType,
  });
  const connected = useFlowStore
    .getState()
    .edges.some(
      (edge) =>
        edge.source === source &&
        edge.target === target &&
        edge.sourceHandle === sourceHandle &&
        edge.targetHandle === targetHandle,
    );
  refreshStudioManagedGraphBinding();
  return connected;
}

function positionNear(
  nodeId: string | undefined,
  fallback: { x: number; y: number },
  offset: { x: number; y: number },
) {
  const node = getNode(nodeId);
  if (!node) return fallback;
  return {
    x: node.position.x + offset.x,
    y: node.position.y + offset.y,
  };
}

export async function addLoraWorkflowBlock(
  form: StudioFormState = useStudioStore.getState().form,
  settings?: StudioTemplateWorkflowBlockSettings['lora'],
  options: ControlledWorkflowOptions = {},
) {
  const context = options.workflowContext ?? captureWorkflowOperationContext();
  assertWorkflowOperationContext(context);
  await createOrUpdateStudioGraph(form, context);
  assertWorkflowOperationContext(context);
  const binding = useStudioStore.getState().graphBinding;
  const usesDirectDiffusersImage = Boolean(binding?.nodes.diffusersImagePipeline);
  const usesDirectDiffusersAudio = Boolean(binding?.nodes.audioPipeline);
  const loraNodeKey = usesDirectDiffusersAudio
    ? CONTROLLED_WORKFLOW_NODE_KEYS.audioLora
    : usesDirectDiffusersImage
      ? CONTROLLED_WORKFLOW_NODE_KEYS.directLora
      : CONTROLLED_WORKFLOW_NODE_KEYS.lora;
  const missing = await ensureRegistryKeys([loraNodeKey]);
  assertWorkflowOperationContext(context);
  if (missing.length > 0) {
    throw new Error(`LoRA block is unavailable because the backend registry is missing ${missing.join(', ')}.`);
  }

  const modelsNode = binding?.nodes.models;
  const directPipelineNode = binding?.nodes.diffusersImagePipeline;
  const directGenerateNode =
    binding?.nodes.diffusersImageInpaint ??
    binding?.nodes.diffusersImageControl ??
    binding?.nodes.diffusersImageEdit ??
    binding?.nodes.diffusersImageGenerate;
  const audioPipelineNode = binding?.nodes.audioPipeline;
  const audioGenerateNode = binding?.nodes.audioGenerate;
  if (!modelsNode && !(directPipelineNode && directGenerateNode) && !(audioPipelineNode && audioGenerateNode)) {
    throw new Error('Create a Studio graph before adding a LoRA adapter block.');
  }

  const adapterSettings: StudioTemplateLoraSettings[] = settings
    ? [settings, ...(settings.additionalAdapters ?? [])]
    : [];
  if (adapterSettings.length > 1 && !usesDirectDiffusersImage) {
    throw new Error('Multiple LoRA adapters currently require the Diffusers image pipeline.');
  }
  const effectiveSettings = adapterSettings.length > 0 ? adapterSettings : [undefined];
  const basePosition = positionNear(
    modelsNode ?? directPipelineNode ?? audioPipelineNode,
    { x: -520, y: 180 },
    { x: 0, y: 270 },
  );
  const expectedRoles = new Set(
    effectiveSettings.map((adapter, index) =>
      index === 0 ? 'loraAdapter' : `loraAdapter:${adapter?.adapterName || index}`,
    ),
  );
  const staleAdapterNodes = useFlowStore
    .getState()
    .nodes.filter(
      (node) =>
        typeof node.data.studioRole === 'string' &&
        node.data.studioRole.startsWith('loraAdapter:') &&
        !expectedRoles.has(node.data.studioRole),
    )
    .map((node) => node.id);
  if (staleAdapterNodes.length > 0) useFlowStore.getState().removeNodes(staleAdapterNodes);

  const loraNodes = effectiveSettings.map((adapter, index) => {
    const role: ControlledNodeRole = index === 0 ? 'loraAdapter' : `loraAdapter:${adapter?.adapterName || index}`;
    const nodeId = ensureControlledNode(loraNodeKey, role, {
      x: basePosition.x + index * 310,
      y: basePosition.y,
    });
    setParamIfPresent(nodeId, ['scale'], adapter?.scale ?? 1);
    setParamIfPresent(nodeId, ['replace_existing'], index === 0);
    if (adapter?.model) {
      setParamIfPresent(nodeId, ['model', 'adapter_path'], {
        source: adapter.model.source,
        value: adapter.model.value,
      });
      setParamIfPresent(nodeId, ['revision'], adapter.model.revision ?? '');
      setParamIfPresent(nodeId, ['expected_sha256'], adapter.model.sha256 ?? '');
    }
    if (adapter?.weightName) {
      setParamIfPresent(nodeId, ['weight_name'], adapter.weightName);
    }
    if (adapter?.adapterName) {
      setParamIfPresent(nodeId, ['adapter_name'], adapter.adapterName);
    }
    return nodeId;
  });
  const loraNode = loraNodes[0];
  if (usesDirectDiffusersAudio && settings?.baseModel) {
    setParamIfPresent(audioPipelineNode, ['model_id', 'model'], {
      source: settings.baseModel.source,
      value: settings.baseModel.value,
    });
    setParamIfPresent(audioPipelineNode, ['revision'], settings.baseModel.revision ?? '');
  }
  if (settings?.schedulerClass) {
    setParamIfPresent(loraNode, ['scheduler_class'], settings.schedulerClass);
  }
  if (settings?.schedulerConfig) {
    setParamIfPresent(loraNode, ['scheduler_config'], JSON.stringify(settings.schedulerConfig));
  }
  let connected = false;
  if (usesDirectDiffusersImage || usesDirectDiffusersAudio) {
    const flow = useFlowStore.getState();
    const sourcePipelineNode = directPipelineNode ?? audioPipelineNode;
    const targetGenerateNode = directGenerateNode ?? audioGenerateNode;
    const bypassEdges = flow.edges
      .filter(
        (edge) =>
          (edge.source === sourcePipelineNode &&
            (edge.target === targetGenerateNode || loraNodes.includes(edge.target))) ||
          (loraNodes.includes(edge.source) && (edge.target === targetGenerateNode || loraNodes.includes(edge.target))),
      )
      .map((edge) => edge.id);
    if (bypassEdges.length > 0) flow.removeEdges(bypassEdges);
    connected = ensureConnection(sourcePipelineNode, ['pipeline'], loraNodes[0], ['pipeline']);
    for (let index = 1; index < loraNodes.length && connected; index += 1) {
      connected = ensureConnection(loraNodes[index - 1], ['output'], loraNodes[index], ['pipeline']);
    }
    connected =
      connected && ensureConnection(loraNodes[loraNodes.length - 1], ['output'], targetGenerateNode, ['pipeline']);
  } else {
    connected = ensureConnection(loraNode, ['lora'], modelsNode, ['lora_list', 'loras']);
  }
  if (!connected) {
    throw new Error('LoRA node was created, but its pipeline connection could not be completed.');
  }

  if (options.notify !== false) {
    enqueueSnackbar('LoRA adapter block added to the graph', { variant: 'success', autoHideDuration: 2200 });
  }
  refreshStudioManagedGraphBinding(loraNodes);
  return loraNode;
}

export async function addUpscaleWorkflowBlock(
  form: StudioFormState = useStudioStore.getState().form,
  settings?: StudioTemplateWorkflowBlockSettings['upscaler'],
  options: ControlledWorkflowOptions = {},
) {
  const context = options.workflowContext ?? captureWorkflowOperationContext();
  assertWorkflowOperationContext(context);
  const missing = await ensureRegistryKeys([
    CONTROLLED_WORKFLOW_NODE_KEYS.upscaler,
    CONTROLLED_WORKFLOW_NODE_KEYS.preview,
  ]);
  assertWorkflowOperationContext(context);
  if (missing.length > 0) {
    throw new Error(`Upscale block is unavailable because the backend registry is missing ${missing.join(', ')}.`);
  }

  await createOrUpdateStudioGraph(form, context);
  assertWorkflowOperationContext(context);
  const binding = useStudioStore.getState().graphBinding;
  const decodeNode = binding?.nodes.decode;
  const directImageNode =
    binding?.nodes.diffusersImageGenerate ??
    binding?.nodes.diffusersImageEdit ??
    binding?.nodes.diffusersImageInpaint ??
    binding?.nodes.diffusersImageControl;
  const videoGenerateNode = binding?.nodes.wanGenerate;
  const videoExportNode = binding?.nodes.videoExport;
  const qualityVideoGenerateNode = findControlledNode(
    CONTROLLED_WORKFLOW_NODE_KEYS.qualityVideoGenerate,
    'qualityVideoGenerate',
  );
  const qualityVideoRetainNode = findControlledNode(
    CONTROLLED_WORKFLOW_NODE_KEYS.qualityVideoRetain,
    'qualityVideoRetain',
  );
  const videoComposeNode = findControlledNode(CONTROLLED_WORKFLOW_NODE_KEYS.videoCompose, 'videoCompose')?.id;
  const videoDeliverySource = videoComposeNode ?? qualityVideoGenerateNode?.id ?? videoGenerateNode;
  if (
    !decodeNode &&
    !directImageNode &&
    !(qualityVideoGenerateNode && qualityVideoRetainNode) &&
    !(videoGenerateNode && videoExportNode)
  ) {
    throw new Error('Create a Studio graph before adding an Upscale block.');
  }

  const upscalerNode = ensureControlledNode(
    CONTROLLED_WORKFLOW_NODE_KEYS.upscaler,
    'upscaler',
    positionNear(decodeNode ?? directImageNode ?? videoDeliverySource, { x: 930, y: 170 }, { x: 330, y: 250 }),
  );
  setParamIfPresent(upscalerNode, ['device'], form.device);
  if (settings?.model) {
    setParamIfPresent(upscalerNode, ['model_id'], {
      source: settings.model.source,
      value: settings.model.value,
    });
  }
  if (settings?.downscale !== undefined) {
    setParamIfPresent(upscalerNode, ['downscale'], settings.downscale);
  }
  if (qualityVideoGenerateNode && qualityVideoRetainNode) {
    removeEdgesBetween(qualityVideoGenerateNode.id, qualityVideoRetainNode.id);
    const generateConnected = ensureConnection(qualityVideoGenerateNode.id, ['video_out'], upscalerNode, ['image']);
    const retainConnected = ensureConnection(upscalerNode, ['output', 'image'], qualityVideoRetainNode.id, ['video']);
    if (!generateConnected || !retainConnected) {
      throw new Error('Quality-video upscale nodes were created, but their frame handles are not ready yet.');
    }
    if (qualityVideoGenerateNode.parentId) {
      useFlowStore.getState().setNodeLoopParent(upscalerNode, qualityVideoGenerateNode.parentId);
    }
    if (options.notify !== false) {
      enqueueSnackbar('Upscale block added inside the per-shot quality loop', {
        variant: 'success',
        autoHideDuration: 2200,
      });
    }
    return upscalerNode;
  }
  if (videoDeliverySource && videoExportNode) {
    const directEdges = useFlowStore
      .getState()
      .edges.filter(
        (edge) =>
          (edge.source === videoGenerateNode || edge.source === videoComposeNode) && edge.target === videoExportNode,
      )
      .map((edge) => edge.id);
    if (directEdges.length > 0) useFlowStore.getState().removeEdges(directEdges);
    const sourceHandles = videoComposeNode ? ['video'] : ['video_out'];
    const generateConnected = ensureConnection(videoDeliverySource, sourceHandles, upscalerNode, ['image']);
    const exportConnected = ensureConnection(upscalerNode, ['output', 'image'], videoExportNode, ['video']);
    if (!generateConnected || !exportConnected) {
      throw new Error('Video upscale nodes were created, but video/image handles are not ready yet.');
    }
    if (options.notify !== false) {
      enqueueSnackbar('Upscale block added before the Studio video export', {
        variant: 'success',
        autoHideDuration: 2200,
      });
    }
    return upscalerNode;
  }

  const previewNode = ensureControlledNode(
    CONTROLLED_WORKFLOW_NODE_KEYS.preview,
    'upscalePreview',
    positionNear(upscalerNode, { x: 1260, y: 170 }, { x: 330, y: 0 }),
  );

  const imageConnected = ensureConnection(decodeNode ?? directImageNode, ['images', 'image', 'output'], upscalerNode, [
    'image',
  ]);
  const previewConnected = ensureConnection(upscalerNode, ['output', 'image'], previewNode, ['image']);
  if (!imageConnected || !previewConnected) {
    throw new Error(
      'Upscale nodes were created, but image handles are not ready yet. Try Add Upscale again after the registry finishes refreshing.',
    );
  }

  if (options.notify !== false) {
    enqueueSnackbar('Upscale block added after Studio image generation', {
      variant: 'success',
      autoHideDuration: 2200,
    });
  }
  return upscalerNode;
}

function removeEdgesBetween(source: string | undefined, target: string | undefined) {
  if (!source || !target) return;
  const ids = useFlowStore
    .getState()
    .edges.filter((edge) => edge.source === source && edge.target === target)
    .map((edge) => edge.id);
  if (ids.length > 0) useFlowStore.getState().removeEdges(ids);
}

function applySequenceValues(nodeId: string, form: StudioFormState, promptsJson: string) {
  setParamIfPresent(nodeId, ['mode'], 'text_to_video');
  setParamIfPresent(nodeId, ['prompts_json'], promptsJson);
  setParamIfPresent(nodeId, ['negative_prompt'], form.negativePrompt);
  setParamIfPresent(nodeId, ['width'], form.width);
  setParamIfPresent(nodeId, ['height'], form.height);
  setParamIfPresent(nodeId, ['num_frames'], form.numFrames);
  setParamIfPresent(nodeId, ['frame_rate'], form.fps);
  setParamIfPresent(nodeId, ['num_inference_steps'], form.steps);
  setParamIfPresent(nodeId, ['guidance_scale'], form.guidanceScale);
  setParamIfPresent(nodeId, ['seed'], form.seed);
  setParamIfPresent(nodeId, ['output_type'], form.outputType);
  setParamIfPresent(nodeId, ['max_sequence_length'], form.maxSequenceLength);
}

export async function addVideoSequenceWorkflowBlock(
  form: StudioFormState,
  settings?: StudioTemplateWorkflowBlockSettings['videoSequence'],
  options: ControlledWorkflowOptions = {},
) {
  const context = options.workflowContext ?? captureWorkflowOperationContext();
  assertWorkflowOperationContext(context);
  const missing = await ensureRegistryKeys([
    CONTROLLED_WORKFLOW_NODE_KEYS.videoSequence,
    CONTROLLED_WORKFLOW_NODE_KEYS.videoCompose,
  ]);
  assertWorkflowOperationContext(context);
  if (missing.length > 0) throw new Error(`Video sequence block is missing ${missing.join(', ')}.`);
  await createOrUpdateStudioGraph(form, context);
  assertWorkflowOperationContext(context);
  const binding = useStudioStore.getState().graphBinding;
  const pipeline = binding?.nodes.wanPipeline;
  const generate = binding?.nodes.wanGenerate;
  const videoExport = binding?.nodes.videoExport;
  if (!pipeline || !videoExport) throw new Error('Video sequence requires a Studio video graph.');
  const sequence = ensureControlledNode(
    CONTROLLED_WORKFLOW_NODE_KEYS.videoSequence,
    'videoSequence',
    positionNear(pipeline, { x: -100, y: -80 }, { x: 390, y: 0 }),
  );
  const compose = ensureControlledNode(
    CONTROLLED_WORKFLOW_NODE_KEYS.videoCompose,
    'videoCompose',
    positionNear(sequence, { x: 300, y: -80 }, { x: 390, y: 0 }),
  );
  applySequenceValues(sequence, form, settings?.promptsJson ?? '[]');
  if (generate) useFlowStore.getState().setNodeUiState(generate, { disabled: true });
  setParamIfPresent(compose, ['fps'], form.fps);
  setParamIfPresent(compose, ['transition_seconds'], settings?.transitionSeconds ?? 0.35);
  removeEdgesBetween(generate, videoExport);
  if (
    !ensureConnection(pipeline, ['pipeline'], sequence, ['pipeline']) ||
    !ensureConnection(sequence, ['clips'], compose, ['clip_1']) ||
    !ensureConnection(compose, ['video'], videoExport, ['video'])
  ) {
    throw new Error('Video sequence nodes were created, but their media handles are unavailable.');
  }
  return compose;
}

export async function addQualityVideoSequenceWorkflowBlock(
  form: StudioFormState,
  settings?: StudioTemplateWorkflowBlockSettings['qualityVideoSequence'],
  options: ControlledWorkflowOptions = {},
) {
  const context = options.workflowContext ?? captureWorkflowOperationContext();
  assertWorkflowOperationContext(context);
  if (!settings) throw new Error('Quality video sequence settings are required.');
  const executionForm = resolveStudioResourceForm(form);
  const runtimeQuantizationMode = executionForm.resourceMode === 'expert' ? executionForm.quantizationMode : 'none';
  const keys: string[] = [
    CONTROLLED_WORKFLOW_NODE_KEYS.qualityVideoQuantization,
    CONTROLLED_WORKFLOW_NODE_KEYS.qualityVideoRecipe,
    CONTROLLED_WORKFLOW_NODE_KEYS.qualityVideoShots,
    CONTROLLED_WORKFLOW_NODE_KEYS.qualityVideoJobs,
    CONTROLLED_WORKFLOW_NODE_KEYS.qualityVideoLoopItems,
    CONTROLLED_WORKFLOW_NODE_KEYS.qualityVideoGenerate,
    CONTROLLED_WORKFLOW_NODE_KEYS.qualityVideoRetain,
    CONTROLLED_WORKFLOW_NODE_KEYS.qualityVideoLoopResult,
    CONTROLLED_WORKFLOW_NODE_KEYS.qualityVideoJoin,
  ];
  const missing = await ensureRegistryKeys(keys);
  assertWorkflowOperationContext(context);
  if (missing.length > 0) throw new Error(`Quality video sequence is missing ${missing.join(', ')}.`);

  await createOrUpdateStudioGraph(executionForm, context);
  assertWorkflowOperationContext(context);
  const binding = useStudioStore.getState().graphBinding;
  const pipeline = binding?.nodes.wanPipeline;
  const loadImage = binding?.nodes.loadImage;
  const baseGenerate = binding?.nodes.wanGenerate;
  const baseExport = binding?.nodes.videoExport;
  const mode = settings.mode ?? 'image_to_video';
  const executionDevice = executionForm.device;
  const sequenceOffloadMode = mode === 'text_to_video' ? 'none' : executionForm.offloadMode;
  if (!pipeline || (mode === 'image_to_video' && !loadImage))
    throw new Error('Quality video sequence requires a video pipeline and image-to-video also needs keyframe input.');

  const quantization = ensureControlledNode(
    CONTROLLED_WORKFLOW_NODE_KEYS.qualityVideoQuantization,
    'qualityVideoQuantization',
    { x: -930, y: -390 },
  );
  const recipe = ensureControlledNode(CONTROLLED_WORKFLOW_NODE_KEYS.qualityVideoRecipe, 'qualityVideoRecipe', {
    x: -550,
    y: -390,
  });
  const shots = ensureControlledNode(CONTROLLED_WORKFLOW_NODE_KEYS.qualityVideoShots, 'qualityVideoShots', {
    x: -930,
    y: 310,
  });
  const jobs = ensureControlledNode(CONTROLLED_WORKFLOW_NODE_KEYS.qualityVideoJobs, 'qualityVideoJobs', {
    x: -500,
    y: 310,
  });
  const loopItems = ensureControlledNode(CONTROLLED_WORKFLOW_NODE_KEYS.qualityVideoLoopItems, 'qualityVideoLoopItems', {
    x: 10,
    y: 260,
  });
  const generate = ensureControlledNode(CONTROLLED_WORKFLOW_NODE_KEYS.qualityVideoGenerate, 'qualityVideoGenerate', {
    x: 310,
    y: 260,
  });
  const retain = ensureControlledNode(CONTROLLED_WORKFLOW_NODE_KEYS.qualityVideoRetain, 'qualityVideoRetain', {
    x: 610,
    y: 260,
  });
  const result = ensureControlledNode(CONTROLLED_WORKFLOW_NODE_KEYS.qualityVideoLoopResult, 'qualityVideoLoopResult', {
    x: 910,
    y: 260,
  });
  const join = ensureControlledNode(CONTROLLED_WORKFLOW_NODE_KEYS.qualityVideoJoin, 'qualityVideoJoin', {
    x: 1270,
    y: 120,
  });

  setParamIfPresent(quantization, ['backend'], runtimeQuantizationMode);
  setParamIfPresent(
    quantization,
    ['components'],
    mode === 'image_to_video' ? ['transformer', 'transformer_2'] : ['transformer'],
  );
  setParamIfPresent(quantization, ['dtype'], 'bfloat16');
  setParamIfPresent(recipe, ['device_map'], 'none');
  setParamIfPresent(recipe, ['offload_mode'], sequenceOffloadMode);
  setParamIfPresent(recipe, ['device'], executionDevice);
  const supportsNativeFlash = executionDevice.startsWith('cuda');
  setParamIfPresent(recipe, ['attention_backend'], supportsNativeFlash ? '_native_flash' : 'auto');
  setParamIfPresent(
    recipe,
    ['attention_components'],
    supportsNativeFlash ? (mode === 'text_to_video' ? 'transformer' : 'transformer,transformer_2') : '',
  );
  setParamIfPresent(recipe, ['vae_slicing'], true);
  // Video VAE decode can require substantially more memory than denoising.
  // Keep tiling enabled even for resident execution so a sequence that fits
  // through sampling cannot fail only when decoding its frames.
  setParamIfPresent(recipe, ['vae_tiling'], true);
  setParamIfPresent(pipeline, ['device'], executionDevice);
  setParamIfPresent(pipeline, ['auto_offload'], sequenceOffloadMode !== 'none');
  setParamIfPresent(pipeline, ['offload_mode'], sequenceOffloadMode);
  setParamIfPresent(shots, ['shots_json'], settings.shotsJson);
  setParamIfPresent(shots, ['maximum_shots'], 6);
  setParamIfPresent(jobs, ['mode'], mode);
  setParamIfPresent(jobs, ['reference_policy'], mode === 'text_to_video' ? 'none' : 'one_per_shot');
  setParamIfPresent(jobs, ['base_seed'], form.seed);
  setParamIfPresent(jobs, ['fps'], settings.fps ?? (mode === 'text_to_video' ? 24 : 16));
  setParamIfPresent(jobs, ['minimum_seconds'], 5);
  setParamIfPresent(jobs, ['width'], settings.width ?? (mode === 'text_to_video' ? 1280 : 832));
  setParamIfPresent(jobs, ['height'], settings.height ?? (mode === 'text_to_video' ? 704 : 480));
  setParamIfPresent(jobs, ['steps'], settings.steps ?? (mode === 'text_to_video' ? 50 : 40));
  setParamIfPresent(jobs, ['guidance_scale'], settings.guidanceScale ?? (mode === 'text_to_video' ? 5 : 3.5));
  setParamIfPresent(jobs, ['secondary_guidance_scale'], settings.secondaryGuidanceScale ?? 3.5);
  setParamIfPresent(jobs, ['conditioning_strength'], settings.conditioningStrength ?? form.strength);
  setParamIfPresent(jobs, ['negative_prompt'], form.negativePrompt);
  setParamIfPresent(retain, ['quality'], 10);
  setParamIfPresent(retain, ['pin'], true);
  setParamIfPresent(join, ['transition_seconds'], settings.transitionSeconds);
  setParamIfPresent(join, ['pin'], true);

  removeEdgesBetween(baseGenerate, baseExport);
  // Preserve the Studio binding nodes but exclude the obsolete single-shot
  // branch from graph export. Removing them lets a later form synchronization
  // recreate the default Generate node, which would execute after the loop.
  // A disabled binding remains stable across those synchronizations.
  if (baseGenerate) useFlowStore.getState().setNodeUiState(baseGenerate, { disabled: true });
  if (baseExport) useFlowStore.getState().setNodeUiState(baseExport, { disabled: true });

  if (
    !ensureConnection(quantization, ['quantization_config'], recipe, ['quantization_config']) ||
    !ensureConnection(recipe, ['execution_recipe'], pipeline, ['execution_recipe']) ||
    !ensureConnection(shots, ['shots'], jobs, ['shots']) ||
    (mode === 'image_to_video' && !ensureConnection(loadImage, ['image'], jobs, ['opening_images'])) ||
    !ensureConnection(jobs, ['jobs'], loopItems, ['collection']) ||
    !ensureConnection(pipeline, ['pipeline'], generate, ['pipeline']) ||
    !ensureConnection(loopItems, ['item'], generate, ['job']) ||
    !ensureConnection(generate, ['video_out'], retain, ['video']) ||
    !ensureConnection(generate, ['fps_out'], retain, ['fps']) ||
    !ensureConnection(retain, ['asset'], result, ['value_input']) ||
    !ensureConnection(result, ['collection'], join, ['clips'])
  ) {
    throw new Error('Quality video sequence nodes were created, but one or more media handles are unavailable.');
  }

  const bodyIds = [loopItems, generate, retain, result];
  const flow = useFlowStore.getState();
  const existingLoopIds = new Set(flow.nodes.filter((node) => node.data.type === 'loop').map((node) => node.id));
  flow.loopNodes(bodyIds);
  const loop = useFlowStore.getState().nodes.find((node) => node.data.type === 'loop' && !existingLoopIds.has(node.id));
  if (!loop) throw new Error('Quality video sequence could not create its visible collection loop.');
  setParamIfPresent(loop.id, ['iteration_mode'], 'collection');
  setParamIfPresent(loop.id, ['iterations'], 6);
  setParamIfPresent(loop.id, ['max_iterations'], 6);
  setParamIfPresent(loop.id, ['carry'], false);
  setParamIfPresent(loop.id, ['collect'], true);
  setParamIfPresent(loop.id, ['max_retries'], 1);
  return join;
}

export async function addSoundtrackWorkflowBlock(
  form: StudioFormState,
  settings?: StudioTemplateWorkflowBlockSettings['soundtrack'],
  options: ControlledWorkflowOptions = {},
) {
  const context = options.workflowContext ?? captureWorkflowOperationContext();
  assertWorkflowOperationContext(context);
  if (!settings) throw new Error('Soundtrack settings are required.');
  const executionForm = resolveStudioResourceForm(form);
  const requiredKeys = [
    CONTROLLED_WORKFLOW_NODE_KEYS.soundtrackQuantization,
    CONTROLLED_WORKFLOW_NODE_KEYS.soundtrackRecipe,
    CONTROLLED_WORKFLOW_NODE_KEYS.soundtrackPipeline,
    CONTROLLED_WORKFLOW_NODE_KEYS.soundtrackGenerate,
    CONTROLLED_WORKFLOW_NODE_KEYS.audioFit,
    CONTROLLED_WORKFLOW_NODE_KEYS.exportWithAudio,
  ];
  const missing = await ensureRegistryKeys(requiredKeys);
  assertWorkflowOperationContext(context);
  if (missing.length > 0) throw new Error(`Soundtrack block is missing ${missing.join(', ')}.`);

  await createOrUpdateStudioGraph(executionForm, context);
  assertWorkflowOperationContext(context);
  const binding = useStudioStore.getState().graphBinding;
  const videoGenerate = binding?.nodes.wanGenerate;
  const videoExport = binding?.nodes.videoExport;
  const upscaler = findControlledNode(CONTROLLED_WORKFLOW_NODE_KEYS.upscaler, 'upscaler')?.id;
  const videoCompose = findControlledNode(CONTROLLED_WORKFLOW_NODE_KEYS.videoCompose, 'videoCompose')?.id;
  const videoSource = upscaler ?? videoCompose ?? videoGenerate;
  if (!videoSource || !videoExport) throw new Error('Soundtrack requires a Studio video graph.');

  const quantization = ensureControlledNode(
    CONTROLLED_WORKFLOW_NODE_KEYS.soundtrackQuantization,
    'soundtrackQuantization',
    { x: -930, y: 420 },
  );
  const recipe = ensureControlledNode(CONTROLLED_WORKFLOW_NODE_KEYS.soundtrackRecipe, 'soundtrackRecipe', {
    x: -550,
    y: 420,
  });
  const pipeline = ensureControlledNode(CONTROLLED_WORKFLOW_NODE_KEYS.soundtrackPipeline, 'soundtrackPipeline', {
    x: -170,
    y: 420,
  });
  const generate = ensureControlledNode(CONTROLLED_WORKFLOW_NODE_KEYS.soundtrackGenerate, 'soundtrackGenerate', {
    x: 220,
    y: 420,
  });
  const audioFit = ensureControlledNode(CONTROLLED_WORKFLOW_NODE_KEYS.audioFit, 'soundtrackAudioFit', {
    x: 620,
    y: 420,
  });
  const exporter = ensureControlledNode(CONTROLLED_WORKFLOW_NODE_KEYS.exportWithAudio, 'exportWithAudio', {
    x: 1050,
    y: 140,
  });

  setParamIfPresent(quantization, ['backend'], 'none');
  setParamIfPresent(quantization, ['components'], []);
  setParamIfPresent(quantization, ['dtype'], executionForm.dtype);
  setParamIfPresent(recipe, ['device_map'], 'none');
  setParamIfPresent(recipe, ['offload_mode'], executionForm.offloadMode);
  setParamIfPresent(recipe, ['device'], executionForm.device);
  // ACE-Step supplies an attention mask. On the qualified ROCm stack both
  // AITER and the native-flash dispatch can reject masked attention, so use
  // the portable PyTorch math SDPA path for this small eight-step branch.
  setParamIfPresent(recipe, ['attention_backend'], '_native_math');
  setParamIfPresent(recipe, ['attention_components'], '');
  setParamIfPresent(recipe, ['vae_slicing'], true);
  setParamIfPresent(recipe, ['vae_tiling'], true);
  setParamIfPresent(pipeline, ['model_id'], { source: settings.model.source, value: settings.model.value });
  if (settings.model.revision) setParamIfPresent(pipeline, ['revision'], settings.model.revision);
  setParamIfPresent(pipeline, ['pipeline_class'], settings.pipelineClass);
  setParamIfPresent(pipeline, ['mode'], 'text_to_audio');
  setParamIfPresent(pipeline, ['dtype'], executionForm.dtype);
  setParamIfPresent(pipeline, ['device'], executionForm.device);
  setParamIfPresent(pipeline, ['auto_offload'], executionForm.autoOffload);
  setParamIfPresent(pipeline, ['offload_mode'], executionForm.offloadMode);
  setParamIfPresent(generate, ['task_type'], 'text2music');
  setParamIfPresent(generate, ['prompt'], settings.prompt);
  setParamIfPresent(generate, ['negative_prompt'], settings.negativePrompt ?? '');
  setParamIfPresent(generate, ['lyrics'], '');
  setParamIfPresent(generate, ['audio_duration'], settings.durationSeconds);
  setParamIfPresent(generate, ['num_inference_steps'], settings.steps);
  setParamIfPresent(generate, ['guidance_scale'], settings.guidanceScale);
  setParamIfPresent(generate, ['stable_audio_steps'], settings.steps);
  setParamIfPresent(generate, ['stable_audio_guidance'], settings.guidanceScale);
  setParamIfPresent(generate, ['seed'], settings.seed);
  setParamIfPresent(generate, ['bpm'], settings.bpm ?? 0);
  setParamIfPresent(generate, ['keyscale'], settings.keyscale ?? '');
  setParamIfPresent(generate, ['timesignature'], settings.timesignature ?? '4/4');
  const isStableAudioPipeline = settings.pipelineClass === 'StableAudioPipeline';
  setParamIfPresent(generate, ['lora_scale'], true, 'hidden');
  setParamIfPresent(generate, ['stable_audio_steps'], !isStableAudioPipeline, 'hidden');
  setParamIfPresent(generate, ['stable_audio_guidance'], !isStableAudioPipeline, 'hidden');
  setParamIfPresent(generate, ['num_waveforms'], !isStableAudioPipeline, 'hidden');
  setParamIfPresent(generate, ['negative_prompt'], !isStableAudioPipeline, 'hidden');
  setParamIfPresent(generate, ['lyrics'], isStableAudioPipeline, 'hidden');
  setParamIfPresent(generate, ['extension_duration'], true, 'hidden');
  setParamIfPresent(generate, ['vocal_language'], isStableAudioPipeline, 'hidden');
  setParamIfPresent(generate, ['num_inference_steps'], isStableAudioPipeline, 'hidden');
  setParamIfPresent(generate, ['guidance_scale'], isStableAudioPipeline, 'hidden');
  setParamIfPresent(generate, ['shift'], isStableAudioPipeline, 'hidden');
  setParamIfPresent(generate, ['bpm'], isStableAudioPipeline, 'hidden');
  setParamIfPresent(generate, ['keyscale'], isStableAudioPipeline, 'hidden');
  setParamIfPresent(generate, ['timesignature'], isStableAudioPipeline, 'hidden');
  setParamIfPresent(generate, ['repainting_start'], true, 'hidden');
  setParamIfPresent(generate, ['repainting_end'], true, 'hidden');
  setParamIfPresent(generate, ['audio_cover_strength'], true, 'hidden');
  setParamIfPresent(generate, ['return_continuation_tail'], true, 'hidden');
  applyAudioFitValues(audioFit, settings.audioFit);
  setParamIfPresent(exporter, ['fps'], form.fps);
  setParamIfPresent(exporter, ['quality'], 10);

  // The muxed exporter replaces the plain video exporter for soundtrack
  // workflows. Keeping the old exporter disabled left a dead node in every
  // graph built from this template and made the canonical workflow fail its
  // executable-path audit. Remove it and alias the managed delivery role to
  // the muxed exporter so form updates (notably FPS) still reach the active
  // output node without changing the visible graph into a custom graph.
  useFlowStore.getState().removeNodes(videoExport);
  const currentBinding = useStudioStore.getState().graphBinding;
  if (currentBinding) {
    const managedNodeIds = Array.from(
      new Set([...(currentBinding.managedNodeIds ?? []).filter((nodeId) => nodeId !== videoExport), exporter]),
    );
    const managedNodes = new Set(managedNodeIds);
    useStudioStore.getState().setGraphBinding({
      ...currentBinding,
      nodes: { ...currentBinding.nodes, videoExport: exporter },
      managedNodeIds,
      managedEdgeIds: useFlowStore
        .getState()
        .edges.filter((edge) => edge.source !== videoExport && edge.target !== videoExport)
        .filter((edge) => managedNodes.has(edge.source) && managedNodes.has(edge.target))
        .map((edge) => edge.id),
      updatedAt: Date.now(),
    });
  }

  const videoHandles = upscaler ? ['output', 'image'] : videoCompose ? ['video'] : ['video_out'];
  if (
    !ensureConnection(quantization, ['quantization_config'], recipe, ['quantization_config']) ||
    !ensureConnection(recipe, ['execution_recipe'], pipeline, ['execution_recipe']) ||
    !ensureConnection(pipeline, ['pipeline'], generate, ['pipeline']) ||
    !ensureConnection(generate, ['audio'], audioFit, ['audio']) ||
    !ensureConnection(audioFit, ['output'], exporter, ['audio']) ||
    !ensureConnection(videoSource, videoHandles, exporter, ['video'])
  ) {
    throw new Error('Soundtrack nodes were created, but their audio/video handles are unavailable.');
  }
  return exporter;
}

export async function addLyricVideoWorkflowBlock(
  form: StudioFormState,
  settings?: StudioTemplateWorkflowBlockSettings['lyricVideo'],
  options: ControlledWorkflowOptions = {},
) {
  const context = options.workflowContext ?? captureWorkflowOperationContext();
  assertWorkflowOperationContext(context);
  if (!settings) throw new Error('Lyric video settings are required.');
  const executionForm = resolveStudioResourceForm(form);
  const runtimeQuantizationMode = executionForm.resourceMode === 'expert' ? executionForm.quantizationMode : 'none';
  const requiredKeys: string[] = [
    CONTROLLED_WORKFLOW_NODE_KEYS.lyricVideoQuantization,
    CONTROLLED_WORKFLOW_NODE_KEYS.lyricVideoRecipe,
    CONTROLLED_WORKFLOW_NODE_KEYS.videoPipeline,
    CONTROLLED_WORKFLOW_NODE_KEYS.videoSequence,
    CONTROLLED_WORKFLOW_NODE_KEYS.videoCompose,
    CONTROLLED_WORKFLOW_NODE_KEYS.upscaler,
    CONTROLLED_WORKFLOW_NODE_KEYS.lyricOverlay,
    CONTROLLED_WORKFLOW_NODE_KEYS.audioFit,
    CONTROLLED_WORKFLOW_NODE_KEYS.exportWithAudio,
  ];
  const missing = await ensureRegistryKeys(requiredKeys);
  assertWorkflowOperationContext(context);
  if (missing.length > 0) throw new Error(`Lyric video block is missing ${missing.join(', ')}.`);
  await createOrUpdateStudioGraph(executionForm, context);
  assertWorkflowOperationContext(context);
  const binding = useStudioStore.getState().graphBinding;
  const audioGenerate = binding?.nodes.audioGenerate;
  if (!audioGenerate) throw new Error('Lyric video requires the ACE-Step audio graph.');
  const quantization = ensureControlledNode(
    CONTROLLED_WORKFLOW_NODE_KEYS.lyricVideoQuantization,
    'lyricVideoQuantization',
    { x: -1280, y: 340 },
  );
  const recipe = ensureControlledNode(CONTROLLED_WORKFLOW_NODE_KEYS.lyricVideoRecipe, 'lyricVideoRecipe', {
    x: -900,
    y: 340,
  });
  const pipeline = ensureControlledNode(CONTROLLED_WORKFLOW_NODE_KEYS.videoPipeline, 'lyricVideoPipeline', {
    x: -500,
    y: 340,
  });
  const sequence = ensureControlledNode(CONTROLLED_WORKFLOW_NODE_KEYS.videoSequence, 'videoSequence', {
    x: -100,
    y: 340,
  });
  const compose = ensureControlledNode(CONTROLLED_WORKFLOW_NODE_KEYS.videoCompose, 'videoCompose', { x: 300, y: 340 });
  const upscaler = ensureControlledNode(CONTROLLED_WORKFLOW_NODE_KEYS.upscaler, 'upscaler', { x: 680, y: 340 });
  const overlay = ensureControlledNode(CONTROLLED_WORKFLOW_NODE_KEYS.lyricOverlay, 'lyricOverlay', { x: 1060, y: 340 });
  const audioFit = ensureControlledNode(CONTROLLED_WORKFLOW_NODE_KEYS.audioFit, 'lyricAudioFit', {
    x: 1060,
    y: 720,
  });
  const exporter = ensureControlledNode(CONTROLLED_WORKFLOW_NODE_KEYS.exportWithAudio, 'exportWithAudio', {
    x: 1440,
    y: 180,
  });
  setParamIfPresent(quantization, ['backend'], runtimeQuantizationMode);
  setParamIfPresent(quantization, ['components'], ['transformer']);
  setParamIfPresent(quantization, ['dtype'], executionForm.dtype);
  setParamIfPresent(recipe, ['device_map'], 'none');
  setParamIfPresent(recipe, ['offload_mode'], executionForm.offloadMode);
  setParamIfPresent(recipe, ['device'], executionForm.device);
  setParamIfPresent(recipe, ['attention_backend'], 'auto');
  setParamIfPresent(recipe, ['attention_components'], '');
  setParamIfPresent(recipe, ['vae_slicing'], true);
  setParamIfPresent(recipe, ['vae_tiling'], true);
  setParamIfPresent(pipeline, ['model_id'], { source: settings.visualModel.source, value: settings.visualModel.value });
  setParamIfPresent(pipeline, ['pipeline_class'], 'LTXConditionPipeline');
  setParamIfPresent(pipeline, ['dtype'], executionForm.dtype);
  setParamIfPresent(pipeline, ['device'], executionForm.device);
  setParamIfPresent(pipeline, ['auto_offload'], executionForm.autoOffload);
  setParamIfPresent(pipeline, ['offload_mode'], executionForm.offloadMode);
  applySequenceValues(
    sequence,
    { ...form, width: 768, height: 512, numFrames: 81, steps: 8, guidanceScale: 1 },
    settings.promptsJson,
  );
  setParamIfPresent(compose, ['fps'], 16);
  setParamIfPresent(compose, ['transition_seconds'], settings.transitionSeconds);
  setParamIfPresent(upscaler, ['model_id'], {
    source: VIDEO_DELIVERY_UPSCALER.model.source,
    value: VIDEO_DELIVERY_UPSCALER.model.value,
  });
  setParamIfPresent(upscaler, ['downscale'], VIDEO_DELIVERY_UPSCALER.downscale);
  setParamIfPresent(overlay, ['lrc'], settings.lrc);
  setParamIfPresent(overlay, ['fps'], 16);
  setParamIfPresent(overlay, ['font_size'], settings.fontSize ?? 58);
  setParamIfPresent(overlay, ['bottom_margin'], settings.bottomMargin ?? 70);
  setParamIfPresent(audioGenerate, ['task_type'], 'text2music');
  setParamIfPresent(audioGenerate, ['prompt'], settings.audio.prompt);
  setParamIfPresent(audioGenerate, ['negative_prompt'], '');
  setParamIfPresent(audioGenerate, ['lyrics'], settings.audio.lyrics);
  setParamIfPresent(audioGenerate, ['audio_duration'], settings.audio.durationSeconds);
  setParamIfPresent(audioGenerate, ['num_inference_steps'], settings.audio.steps);
  setParamIfPresent(audioGenerate, ['guidance_scale'], settings.audio.guidanceScale);
  setParamIfPresent(audioGenerate, ['shift'], settings.audio.shift ?? 3);
  setParamIfPresent(audioGenerate, ['seed'], settings.audio.seed);
  setParamIfPresent(audioGenerate, ['bpm'], settings.audio.bpm ?? 0);
  setParamIfPresent(audioGenerate, ['keyscale'], settings.audio.keyscale ?? '');
  setParamIfPresent(audioGenerate, ['timesignature'], settings.audio.timesignature ?? '4');
  setParamIfPresent(audioGenerate, ['vocal_language'], settings.audio.vocalLanguage ?? 'en');
  setParamIfPresent(audioGenerate, ['sample_rate'], settings.audioFit.targetSampleRate ?? 48000);
  applyAudioFitValues(audioFit, settings.audioFit);
  setParamIfPresent(exporter, ['fps'], 16);
  if (
    !ensureConnection(quantization, ['quantization_config'], recipe, ['quantization_config']) ||
    !ensureConnection(recipe, ['execution_recipe'], pipeline, ['execution_recipe']) ||
    !ensureConnection(pipeline, ['pipeline'], sequence, ['pipeline']) ||
    !ensureConnection(sequence, ['clips'], compose, ['clip_1']) ||
    !ensureConnection(compose, ['video'], upscaler, ['image']) ||
    !ensureConnection(upscaler, ['output'], overlay, ['video']) ||
    !ensureConnection(overlay, ['output'], exporter, ['video']) ||
    !ensureConnection(audioGenerate, ['audio'], audioFit, ['audio']) ||
    !ensureConnection(audioFit, ['output'], exporter, ['audio'])
  ) {
    throw new Error('Lyric video nodes were created, but their media handles are unavailable.');
  }
  return exporter;
}
