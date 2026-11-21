import type { NodeParams } from '../stores/useNodeStore';
import { blockProjectionNodeIdV2, type BlockFlowGraphV2 } from '../studio/blockRuntimeV2';
import type { BlockControlV2, BlockInstanceV2 } from '../studio/blockSchemaV2';
import { isModelSetupAdapterKey } from '../studio/controlledWorkflowContracts';
import { nodeDisplayLabel } from './nodePresentation';

const IMAGE_LOADER = 'modules.DiffusersImage.LoadPipeline';
const AUDIO_LOADER = 'modules.DiffusersAudio.LoadPipeline';
const EXECUTION_RECIPE = 'modules.DiffusersRuntime.DiffusersExecutionRecipe';
const RECIPE_SOCKET = 'execution_recipe';
const RECIPE_TYPE = 'diffusers_execution_recipe';
const VAE_FALLBACKS: Record<string, Record<string, string>> = {
  [IMAGE_LOADER]: { enable_vae_slicing: 'vae_slicing', enable_vae_tiling: 'vae_tiling' },
  [AUDIO_LOADER]: { enable_vae_tiling: 'vae_tiling' },
};

// Only a section copied from one member's own title should follow its
// display caption. A custom or shared section keeps its authored name.
export function modelSetupControlGroupLabel(
  group: string,
  controls: readonly BlockControlV2[],
  graph: BlockFlowGraphV2,
): string {
  const memberId = controls[0]?.binding.nodeId;
  if (!memberId || !controls.every((control) => control.binding.nodeId === memberId)) return group;
  const member = graph.nodes.find((node) => node.data.blockProjectionNodeId === memberId);
  return member?.data.label === group ? nodeDisplayLabel(member.data) : group;
}

/** Only compact Model Setup's displayed controls change. The loader's
 * fallback still belongs to its saved leaf and becomes active on disconnect. */
export function modelSetupControlParams(
  instance: BlockInstanceV2,
  graph: BlockFlowGraphV2,
  params: Record<string, NodeParams>,
): Record<string, NodeParams> {
  const controls = instance.effectiveInterface.controls;
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const leaf = (nodeId: string) => nodes.get(blockProjectionNodeIdV2(instance.instanceId, nodeId));
  const hasAdapterRevision = controls.some((control) => {
    const owner = leaf(control.binding.nodeId);
    return (
      control.binding.fieldId === 'revision' &&
      control.label === 'Revision' &&
      owner &&
      isModelSetupAdapterKey(`${owner.data.module}.${owner.data.action}`)
    );
  });
  const visible = { ...params };
  for (const control of controls) {
    const { nodeId, fieldId } = control.binding;
    const owner = leaf(nodeId);
    const field = params[control.controlId];
    if (!owner || !field) continue;
    const nodeKey = `${owner.data.module}.${owner.data.action}`;
    if (
      hasAdapterRevision &&
      fieldId === 'revision' &&
      control.label === 'Revision' &&
      [IMAGE_LOADER, AUDIO_LOADER, 'modules.ModularDiffusers.ModelsLoader'].includes(nodeKey)
    ) {
      visible[control.controlId] = { ...field, label: 'Base model revision' };
    }
    const recipeField = VAE_FALLBACKS[nodeKey]?.[fieldId];
    const recipeInput = owner.data.params[RECIPE_SOCKET];
    if (
      !recipeField ||
      control.sealed ||
      control.mirrorBindings?.length ||
      control.label !== owner.data.params[fieldId]?.label ||
      owner.data.uiState?.disabled ||
      recipeInput?.type !== RECIPE_TYPE ||
      !(recipeInput.display === 'input' || recipeInput.isInput) ||
      graph.edges.some((edge) => edge.target === owner.id && edge.targetHandle === fieldId)
    )
      continue;
    const incoming = graph.edges.filter((edge) => edge.target === owner.id && edge.targetHandle === RECIPE_SOCKET);
    if (incoming.length !== 1 || incoming[0]?.sourceHandle !== RECIPE_SOCKET) continue;
    const recipe = nodes.get(incoming[0].source);
    if (
      !recipe ||
      `${recipe.data.module}.${recipe.data.action}` !== EXECUTION_RECIPE ||
      recipe.data.uiState?.disabled ||
      recipe.data.params[RECIPE_SOCKET]?.type !== RECIPE_TYPE ||
      recipe.data.params[RECIPE_SOCKET].display !== 'output' ||
      recipe.data.params[recipeField]?.type !== 'bool'
    )
      continue;
    const effective = controls.find(
      (candidate) =>
        candidate.binding.nodeId === recipe.data.blockProjectionNodeId && candidate.binding.fieldId === recipeField,
    );
    const effectiveParam = effective && params[effective.controlId];
    if (effectiveParam && !effectiveParam.hidden) delete visible[control.controlId];
  }
  return visible;
}
