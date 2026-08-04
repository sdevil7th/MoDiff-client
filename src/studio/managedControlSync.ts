import { useFlowStore } from '../stores/useFlowStore';
import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeParams } from '../stores/useNodeStore';
import { useStudioStore } from '../stores/useStudioStore';
import { classifyManagedControl, type ManagedControlFormKey } from './managedControlPolicy';
import type { StudioFormState, StudioGraphBinding } from './types';

const AUDIO_MODES = new Set(['text_to_audio', 'audio_variation', 'audio_continuation', 'audio_repaint']);
const AUDIO_VISUAL_EXTENSION_ROLES = new Set([
  'videoSequence',
  'videoCompose',
  'upscaler',
  'lyricOverlay',
  'exportWithAudio',
]);

function managedControlSemanticKey(
  node: CustomNodeType,
  paramKey: string,
  binding: StudioGraphBinding,
): ManagedControlFormKey | undefined {
  const classification = classifyManagedControl(node.data.studioRole, paramKey, node.data.params[paramKey]);
  if (classification.formKey) return classification.formKey;
  if (node.data.studioRole === 'loadImage' && paramKey === 'file') {
    return binding.mode === 'control_image' ? 'controlImage' : 'referenceImages';
  }
  if (node.data.studioRole === 'wanGenerate' && paramKey === 'strength') {
    return binding.modelType === 'LTXVideoPipeline' && binding.mode === 'video_to_video'
      ? 'conditioningScale'
      : 'strength';
  }
  return undefined;
}

export function managedControlSyncGroup(node: CustomNodeType, paramKey: string, binding: StudioGraphBinding) {
  const semanticKey = managedControlSemanticKey(node, paramKey, binding);
  if (!semanticKey) return undefined;
  const role = node.data.studioRole ?? '';
  if (role.startsWith('soundtrack')) return `soundtrack:${semanticKey}`;
  if (role.startsWith('qualityVideo')) return `quality-video:${semanticKey}`;
  if (AUDIO_MODES.has(binding.mode) && (AUDIO_VISUAL_EXTENSION_ROLES.has(role) || role.startsWith('lyricVideo'))) {
    return `lyric-visual:${semanticKey}`;
  }
  return `form:${semanticKey}`;
}

export function managedControlFormKey(
  node: CustomNodeType,
  paramKey: string,
  binding: StudioGraphBinding,
): ManagedControlFormKey | undefined {
  const syncGroup = managedControlSyncGroup(node, paramKey, binding);
  return syncGroup?.startsWith('form:') ? managedControlSemanticKey(node, paramKey, binding) : undefined;
}

function managedNodes(binding: StudioGraphBinding) {
  const managedNodeIds = new Set(binding.managedNodeIds);
  return useFlowStore.getState().nodes.filter((node) => managedNodeIds.has(node.id) || node.data.studioOwned === true);
}

function valueForTarget(sourceValue: unknown, targetParam: NodeParams, randomSeed: boolean) {
  const sourceRecord =
    typeof sourceValue === 'object' && sourceValue !== null && !Array.isArray(sourceValue)
      ? (sourceValue as Record<string, unknown>)
      : null;
  const sourceScalar = sourceRecord && 'value' in sourceRecord ? sourceRecord.value : sourceValue;
  const targetType = Array.isArray(targetParam.type) ? targetParam.type[0] : targetParam.type;
  const targetIsRandom =
    targetParam.display === 'random' ||
    (typeof targetParam.value === 'object' &&
      targetParam.value !== null &&
      !Array.isArray(targetParam.value) &&
      'isRandom' in targetParam.value);

  if (targetIsRandom) {
    return {
      value: sourceScalar,
      isRandom: sourceRecord && 'isRandom' in sourceRecord ? Boolean(sourceRecord.isRandom) : randomSeed,
    };
  }
  if (targetType === 'int' || targetType === 'float' || targetType === 'number') {
    const numericValue = Number(sourceScalar);
    return Number.isFinite(numericValue) ? numericValue : sourceScalar;
  }
  return sourceScalar;
}

function formPatchForControl(formKey: keyof StudioFormState, value: unknown): Partial<StudioFormState> | null {
  const form = useStudioStore.getState().form;
  if (formKey === 'seed' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const parsedSeed = Number((value as Record<string, unknown>).value);
    if (!Number.isFinite(parsedSeed)) return null;
    return {
      seed: parsedSeed,
      randomSeed: Boolean((value as Record<string, unknown>).isRandom),
    };
  }

  const currentValue = form[formKey];
  let normalized: unknown = value;
  if (Array.isArray(currentValue)) {
    normalized = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : typeof value === 'string'
        ? [value]
        : [];
  } else if (typeof currentValue === 'number') {
    const parsed = Number(
      typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>).value
        : value,
    );
    if (!Number.isFinite(parsed)) return null;
    normalized = parsed;
  } else if (typeof currentValue === 'boolean') {
    normalized = Boolean(value);
  } else if (Array.isArray(value)) {
    normalized = value.find((item): item is string => typeof item === 'string') ?? '';
  } else {
    normalized = value === null || value === undefined ? '' : String(value);
  }

  if (formKey === 'width' || formKey === 'height') {
    return {
      [formKey]: normalized,
      aspectRatio: 'custom',
    } as Partial<StudioFormState>;
  }
  return { [formKey]: normalized } as Partial<StudioFormState>;
}

export function syncManagedControlGroup(
  binding: StudioGraphBinding,
  syncGroup: string,
  sourceValue: unknown,
  randomSeed = false,
) {
  managedNodes(binding).forEach((node) => {
    Object.entries(node.data.params ?? {}).forEach(([paramKey, param]) => {
      if (managedControlSyncGroup(node, paramKey, binding) !== syncGroup) return;
      useFlowStore.getState().setParam(node.id, paramKey, valueForTarget(sourceValue, param, randomSeed));
    });
  });
}

export function syncManagedFormControlAliases(form: StudioFormState, binding: StudioGraphBinding) {
  const syncGroups = new Set<string>();
  managedNodes(binding).forEach((node) => {
    Object.keys(node.data.params ?? {}).forEach((paramKey) => {
      const syncGroup = managedControlSyncGroup(node, paramKey, binding);
      if (syncGroup?.startsWith('form:')) syncGroups.add(syncGroup);
    });
  });

  syncGroups.forEach((syncGroup) => {
    const formKey = syncGroup.slice('form:'.length) as keyof StudioFormState;
    syncManagedControlGroup(binding, syncGroup, form[formKey], form.randomSeed);
  });
}

export function syncManagedNodeControlChange(nodeId: string, paramKey: string, value: unknown, key?: keyof NodeParams) {
  if (key !== undefined && key !== 'value') return;
  const node = useFlowStore.getState().nodes.find((item) => item.id === nodeId);
  if (!node) return;
  const param = node.data.params?.[paramKey];
  const studio = useStudioStore.getState();
  const binding = studio.graphBinding;
  const managedNode = Boolean(binding && (binding.managedNodeIds.includes(nodeId) || node.data.studioOwned === true));
  const formKey = managedNode && binding ? managedControlFormKey(node, paramKey, binding) : undefined;
  if (param && studio.form.resourceMode === 'auto') {
    const classification = classifyManagedControl(node.data.studioRole, paramKey, param);
    if (classification.surface === 'advanced') {
      studio.pinAutoFieldOverride(nodeId, paramKey, value, formKey);
    }
  }

  // Form aliases are intentionally limited to managed Studio graphs. Manual
  // and imported graphs still retain their workflow-local override above.
  if (!managedNode || !binding) return;
  const syncGroup = managedControlSyncGroup(node, paramKey, binding);
  if (!syncGroup) return;
  let form = useStudioStore.getState().form;
  if (formKey) {
    const patch = formPatchForControl(formKey, value);
    if (!patch) return;
    useStudioStore.getState().updateForm(patch);
    form = useStudioStore.getState().form;
    syncManagedControlGroup(binding, syncGroup, form[formKey], form.randomSeed);
    return;
  }
  syncManagedControlGroup(binding, syncGroup, value, form.randomSeed);
}
