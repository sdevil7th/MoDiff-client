import type { Edge } from '@xyflow/react';
import { canonicalizePersistedBlockRootV2, setBlockInstanceValueV2 } from '../studio/blockRuntimeV2';
import { isRecord } from '../studio/outputContracts';
import { savedAttentionDefaultUpdate } from '../studio/savedStudioSpecCompatibility';
import type { StudioGraphBinding } from '../studio/types';
import type { CustomNodeType } from '../stores/useFlowStore';

const LEGACY_UNCONDITIONAL_MODELS = new Map([
  ['DDPMPipeline', ['google/ddpm-cifar10-32', '267b167dc01f0e4e61923ea244e8b988f84deb80']],
  ['ConsistencyModelPipeline', ['openai/diffusers-cd_imagenet64_l2', '5f462e4403fc37b72ec6004e806c71805db22387']],
]);

function hasLegacyUnconditionalPin(params: unknown) {
  if (!isRecord(params)) return false;
  const value = (field: string) => {
    const param = params[field];
    return isRecord(param) ? param.value : undefined;
  };
  const selection = value('model_id');
  const model = LEGACY_UNCONDITIONAL_MODELS.get(String(value('pipeline_class')));
  return (
    model &&
    isRecord(selection) &&
    selection.source === 'hub' &&
    selection.value === model[0] &&
    value('revision') === model[1] &&
    value('mode') === 'unconditional_image'
  );
}

/** Replace the old published stage default on restore. Instance edits win. */
export function restoreSavedAttentionDefaults(nodes: CustomNodeType[], requested?: string) {
  if (requested && requested !== 'auto') return nodes;
  return nodes.map((root) => {
    const instance = root.data.blockInstanceV2;
    if (
      !instance ||
      instance.definitionSnapshot.source.provider !== 'modiff.visual-stages.v1/setup' ||
      instance.customization.baseGraphHash !== instance.customization.effectiveGraphHash
    )
      return root;

    const { nodes, edges } = instance.effectiveGraph;
    if (nodes.length !== 3 || edges.length !== 2) return root;
    const loader = nodes.find(({ data }) => data.module === 'modules.DiffusersImage' && data.action === 'LoadPipeline');
    const recipe = nodes.find(
      ({ data }) => data.module === 'modules.DiffusersRuntime' && data.action === 'DiffusersExecutionRecipe',
    );
    const quantization = nodes.find(
      ({ data }) => data.module === 'modules.DiffusersRuntime' && data.action === 'PipelineQuantizationConfigV2',
    );
    if (!loader || !recipe || !quantization) return root;
    if (
      !hasLegacyUnconditionalPin(loader.data.params) ||
      !edges.some(
        (edge) =>
          edge.sourceNodeId === recipe.nodeId &&
          edge.sourcePortId === 'execution_recipe' &&
          edge.targetNodeId === loader.nodeId &&
          edge.targetPortId === 'execution_recipe',
      ) ||
      !edges.some(
        (edge) =>
          edge.sourceNodeId === quantization.nodeId &&
          edge.sourcePortId === 'quantization_config' &&
          edge.targetNodeId === recipe.nodeId &&
          edge.targetPortId === 'quantization_config',
      )
    )
      return root;

    const attention = isRecord(recipe.data.params) ? recipe.data.params.attention_backend : undefined;
    const control = instance.effectiveInterface.controls.find(
      ({ binding }) => binding.nodeId === recipe.nodeId && binding.fieldId === 'attention_backend',
    );
    if (
      !isRecord(attention) ||
      attention.value !== '_native_math' ||
      attention.default !== 'auto' ||
      control?.defaultValue !== '_native_math' ||
      control.sealed ||
      control.mirrorBindings?.length ||
      Object.prototype.hasOwnProperty.call(instance.values, control.controlId)
    )
      return root;

    return canonicalizePersistedBlockRootV2({
      ...root,
      data: { ...root.data, blockInstanceV2: setBlockInstanceValueV2(instance, control.controlId, 'auto') },
    });
  });
}

export function restoreManagedAttentionDefault(
  nodes: unknown[],
  edges: Edge[],
  binding: StudioGraphBinding | null,
  requested?: string,
) {
  if (
    binding?.mode !== 'unconditional_image' ||
    !savedAttentionDefaultUpdate(binding) ||
    (requested && requested !== 'auto')
  )
    return nodes;
  const recipe = nodes.find((node) => isRecord(node) && node.id === binding.nodes.diffusersRecipe);
  const loader = nodes.find((node) => isRecord(node) && node.id === binding.nodes.diffusersImagePipeline);
  if (
    !isRecord(recipe) ||
    !isRecord(recipe.data) ||
    !isRecord(recipe.data.params) ||
    !isRecord(loader) ||
    !isRecord(loader.data)
  )
    return nodes;
  const params = recipe.data.params;
  const field = params.attention_backend;
  if (
    recipe.data.module !== 'modules.DiffusersRuntime' ||
    recipe.data.action !== 'DiffusersExecutionRecipe' ||
    loader.data.module !== 'modules.DiffusersImage' ||
    loader.data.action !== 'LoadPipeline' ||
    !hasLegacyUnconditionalPin(loader.data.params) ||
    !isRecord(field) ||
    field.value !== '_native_math' ||
    field.default !== 'auto' ||
    !edges.some(
      ({ source, sourceHandle, target, targetHandle }) =>
        source === recipe.id &&
        sourceHandle === 'execution_recipe' &&
        target === loader.id &&
        targetHandle === 'execution_recipe',
    )
  )
    return nodes;
  const updated = {
    ...recipe,
    data: { ...recipe.data, params: { ...params, attention_backend: { ...field, value: 'auto' } } },
  };
  return nodes.map((node) => (node === recipe ? updated : node));
}
