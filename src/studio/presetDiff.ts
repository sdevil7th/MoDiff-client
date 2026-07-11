import { nanoid } from 'nanoid';
import { useFlowStore } from '../stores/useFlowStore';
import { useStudioStore, type StudioRecentChange } from '../stores/useStudioStore';
import { deepEqual } from '../utils/deepEqual';
import type { StudioFormState } from './types';

const FIELD_LABELS: Partial<Record<keyof StudioFormState, string>> = {
  aspectRatio: 'Aspect',
  attentionKwargsJson: 'Attention kwargs',
  autoOffload: 'Auto-offload',
  conditioningScale: 'Conditioning',
  controlImage: 'Control image',
  controlVideo: 'Control video',
  device: 'Device',
  dtype: 'Precision',
  fps: 'FPS',
  guidanceScale: 'Guidance',
  guidanceScale2: 'Guidance 2',
  height: 'Height',
  maskImage: 'Mask image',
  maskVideo: 'Mask video',
  maxSequenceLength: 'Max tokens',
  modelType: 'Model',
  mode: 'Task',
  negativePrompt: 'Negative prompt',
  numFrames: 'Frames',
  outputType: 'Output type',
  offloadMode: 'Offload mode',
  outpaintBottom: 'Outpaint bottom',
  outpaintFeather: 'Outpaint feather',
  outpaintFillColor: 'Outpaint fill',
  outpaintLeft: 'Outpaint left',
  outpaintOverlap: 'Outpaint overlap',
  outpaintRight: 'Outpaint right',
  outpaintTop: 'Outpaint top',
  prompt: 'Prompt',
  quantizationMode: 'Quantization',
  randomSeed: 'Random seed',
  referenceImages: 'References',
  resourceMode: 'Resource mode',
  seed: 'Seed',
  sourceVideo: 'Source video',
  steps: 'Steps',
  strength: 'Strength',
  width: 'Width',
};

export function studioFieldLabel(key: keyof StudioFormState) {
  return FIELD_LABELS[key] ?? String(key);
}

export function formatStudioFieldValue(value: unknown) {
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : 'empty';
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (value === undefined || value === null || value === '') return 'empty';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function diffStudioFormValues(
  before: StudioFormState,
  after: StudioFormState,
  keys: Array<keyof StudioFormState>,
): StudioRecentChange['fields'] {
  return keys
    .filter((key) => !deepEqual(before[key], after[key]))
    .map((key) => ({
      key,
      label: studioFieldLabel(key),
      before: before[key],
      after: after[key],
    }));
}

export function publishStudioChange(label: string, fields: StudioRecentChange['fields'], nodeIds: string[]) {
  if (fields.length === 0) return;

  const createdAt = Date.now();
  const change: StudioRecentChange = {
    id: nanoid(),
    label,
    fields,
    createdAt,
  };
  useStudioStore.getState().setRecentChange(change);

  const summary = `${label}: ${fields
    .map((field) => field.label)
    .slice(0, 4)
    .join(', ')}`;
  const uniqueNodeIds = Array.from(new Set(nodeIds));
  uniqueNodeIds.forEach((nodeId) => {
    useFlowStore.getState().setNodeUiState(nodeId, {
      recentChangeLabel: summary,
      recentChangeAt: createdAt,
    });
  });

  window.setTimeout(() => {
    const studio = useStudioStore.getState();
    if (studio.recentChange?.createdAt === createdAt) {
      studio.setRecentChange(null);
    }
    useFlowStore.getState().nodes.forEach((node) => {
      if (node.data.uiState?.recentChangeAt !== createdAt) return;
      useFlowStore.getState().setNodeUiState(node.id, {
        recentChangeLabel: undefined,
        recentChangeAt: undefined,
      });
    });
  }, 4500);
}
