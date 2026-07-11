import { nanoid } from 'nanoid';
import { enqueueSnackbar } from '../ui/snackbar';
import { useFlowStore, type CustomNodeType } from '../stores/useFlowStore';
import { type NodeData, type NodeParams, useNodesStore } from '../stores/useNodeStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useStudioStore } from '../stores/useStudioStore';
import { createOrUpdateStudioGraph } from './graphBridge';
import type { StudioFormState, StudioTemplateWorkflowBlockSettings } from './types';

export const CONTROLLED_WORKFLOW_NODE_KEYS = {
  lora: 'modules.ModularDiffusers.Lora',
  upscaler: 'modules.Spandrel.Upscaler',
  preview: 'modules.Image.Preview',
} as const;

type ControlledNodeRole = 'loraAdapter' | 'upscaler' | 'upscalePreview';

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
  const existing = findControlledNode(key, role);
  if (existing) return existing.id;

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
      studioOwned: false,
    },
  };
  useFlowStore.getState().addNode(node);
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
  if (exists) return true;

  flow.onConnect({
    source,
    sourceHandle,
    target,
    targetHandle,
    edgeType: useSettingsStore.getState().edgeType,
  });
  return true;
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
) {
  const missing = await ensureRegistryKeys([CONTROLLED_WORKFLOW_NODE_KEYS.lora]);
  if (missing.length > 0) {
    throw new Error(`LoRA block is unavailable because the backend registry is missing ${missing.join(', ')}.`);
  }

  await createOrUpdateStudioGraph(form);
  const binding = useStudioStore.getState().graphBinding;
  const modelsNode = binding?.nodes.models;
  if (!modelsNode) {
    throw new Error('Create a Studio graph before adding a LoRA adapter block.');
  }

  const loraNode = ensureControlledNode(
    CONTROLLED_WORKFLOW_NODE_KEYS.lora,
    'loraAdapter',
    positionNear(modelsNode, { x: -520, y: 180 }, { x: 0, y: 270 }),
  );
  setParamIfPresent(loraNode, ['scale'], settings?.scale ?? 1);
  if (settings?.model) {
    setParamIfPresent(loraNode, ['model'], {
      source: settings.model.source,
      value: settings.model.value,
    });
  }
  if (settings?.weightName) {
    setParamIfPresent(loraNode, ['weight_name'], settings.weightName);
  }
  const connected = ensureConnection(loraNode, ['lora'], modelsNode, ['lora_list', 'loras']);
  if (!connected) {
    throw new Error('LoRA node was created, but ModelsLoader does not expose a lora_list input yet.');
  }

  enqueueSnackbar('LoRA adapter block added to the graph', { variant: 'success', autoHideDuration: 2200 });
  return loraNode;
}

export async function addUpscaleWorkflowBlock(
  form: StudioFormState = useStudioStore.getState().form,
  settings?: StudioTemplateWorkflowBlockSettings['upscaler'],
) {
  const missing = await ensureRegistryKeys([
    CONTROLLED_WORKFLOW_NODE_KEYS.upscaler,
    CONTROLLED_WORKFLOW_NODE_KEYS.preview,
  ]);
  if (missing.length > 0) {
    throw new Error(`Upscale block is unavailable because the backend registry is missing ${missing.join(', ')}.`);
  }

  await createOrUpdateStudioGraph(form);
  const binding = useStudioStore.getState().graphBinding;
  const decodeNode = binding?.nodes.decode;
  if (!decodeNode) {
    throw new Error('Create a Studio graph before adding an Upscale block.');
  }

  const upscalerNode = ensureControlledNode(
    CONTROLLED_WORKFLOW_NODE_KEYS.upscaler,
    'upscaler',
    positionNear(decodeNode, { x: 930, y: 170 }, { x: 330, y: 250 }),
  );
  const previewNode = ensureControlledNode(
    CONTROLLED_WORKFLOW_NODE_KEYS.preview,
    'upscalePreview',
    positionNear(upscalerNode, { x: 1260, y: 170 }, { x: 330, y: 0 }),
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
  const decodeConnected = ensureConnection(decodeNode, ['images', 'image', 'output'], upscalerNode, ['image']);
  const previewConnected = ensureConnection(upscalerNode, ['output', 'image'], previewNode, ['image']);
  if (!decodeConnected || !previewConnected) {
    throw new Error(
      'Upscale nodes were created, but image handles are not ready yet. Try Add Upscale again after the registry finishes refreshing.',
    );
  }

  enqueueSnackbar('Upscale block added after the Studio decode node', { variant: 'success', autoHideDuration: 2200 });
  return upscalerNode;
}
