import type { Edge } from '@xyflow/react';
import type { CustomNodeType } from '../stores/useFlowStore';
import { useNodesStore, type NodeParams } from '../stores/useNodeStore';
import { blockCrossingHandleV2 } from '../studio/blockCrossingConnectionsV2';
import { blockInputPortBindingsV2, blockProjectionNodeIdV2, type BlockFlowGraphV2 } from '../studio/blockRuntimeV2';
import type { BlockControlV2, BlockInstanceV2 } from '../studio/blockSchemaV2';
import { isModelSetupAdapterKey } from '../studio/controlledWorkflowContracts';
import {
  adapterConsumesOffloadMode,
  EXECUTION_RECIPE_NODE,
  literalControlIsOff,
  nodeControlGate,
  visibleExecutionRecipeControls,
} from './gatedNodeControls';
import { nodeDisplayLabel } from './nodePresentation';

const IMAGE_LOADER = 'modules.DiffusersImage.LoadPipeline';
const AUDIO_LOADER = 'modules.DiffusersAudio.LoadPipeline';
const CONDITIONING_KIND = 'conditioning_kind';
const CONDITIONING_MODEL = 'conditioning_model_id';
const CONDITIONING_REVISION = 'conditioning_revision';
const RECIPE_SOCKET = 'execution_recipe';
const RECIPE_TYPE = 'diffusers_execution_recipe';
// The reviewed direct loaders prefer an execution recipe's device and derive
// both offload settings from its mode. Device map and dtype have other rules.
const placementFallbacks = { auto_offload: 'offload_mode', offload_mode: 'offload_mode', device: 'device' };
const RECIPE_FALLBACKS: Record<string, Record<string, string>> = {
  [IMAGE_LOADER]: { ...placementFallbacks, enable_vae_slicing: 'vae_slicing', enable_vae_tiling: 'vae_tiling' },
  [AUDIO_LOADER]: { ...placementFallbacks, enable_vae_tiling: 'vae_tiling' },
  'modules.DiffusersVideo.LoadPipeline': placementFallbacks,
  'modules.DiffusersThreeD.LoadPipeline': placementFallbacks,
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

function hasControlSupplier(
  instance: BlockInstanceV2,
  owner: CustomNodeType,
  fields: string[],
  internalEdges: readonly Edge[],
  workflowEdges: readonly Edge[],
) {
  if (internalEdges.some((edge) => edge.target === owner.id && fields.includes(edge.targetHandle ?? ''))) return true;
  const nodeId = owner.data.blockProjectionNodeId!;
  const handles = new Set(
    fields.map((fieldOrPortId) => blockCrossingHandleV2({ nodeId, fieldOrPortId, direction: 'input' })),
  );
  for (const port of instance.effectiveInterface.boundary.inputs) {
    if (
      blockInputPortBindingsV2(port).some(
        (binding) => binding.nodeId === nodeId && fields.includes(binding.fieldOrPortId),
      )
    )
      handles.add(port.portId);
  }
  return workflowEdges.some((edge) => edge.target === instance.instanceId && handles.has(edge.targetHandle ?? ''));
}

/** Only compact Model Setup's displayed controls change. The loader's
 * fallback still belongs to its saved leaf and becomes active on disconnect. */
export function modelSetupControlParams(
  instance: BlockInstanceV2,
  graph: BlockFlowGraphV2,
  params: Record<string, NodeParams>,
  workflowEdges: readonly Edge[] = [],
  catalog: Pick<
    ReturnType<typeof useNodesStore.getState>,
    'workflowModelDescriptors' | 'studioModelCapabilities'
  > = useNodesStore.getState(),
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
  let visible = { ...params };
  for (const control of controls) {
    const { nodeId, fieldId } = control.binding;
    const owner = leaf(nodeId);
    const field = params[control.controlId];
    if (!owner || !field) continue;
    const nodeKey = `${owner.data.module}.${owner.data.action}`;
    const declared = owner.data.params[fieldId];
    const conditioning = owner.data.params[CONDITIONING_KIND];
    if (nodeControlGate(nodeKey) === 'auto_offload') {
      // normalize_offload_mode ignores mode when this literal switch is off.
      // A connected switch can override its saved fallback at execution.
      const gate = owner.data.params.auto_offload;
      const gatePorts = instance.effectiveInterface.boundary.inputs.filter((port) =>
        blockInputPortBindingsV2(port).some(
          (binding) => binding.nodeId === nodeId && binding.fieldOrPortId === 'auto_offload',
        ),
      );
      if (
        fieldId === 'offload_mode' &&
        literalControlIsOff(gate) &&
        !adapterConsumesOffloadMode(owner.data.params, catalog) &&
        !control.mirrorBindings?.length &&
        !graph.edges.some((e) => e.target === owner.id && e.targetHandle === 'auto_offload') &&
        !workflowEdges.some(
          (e) =>
            e.target === instance.instanceId &&
            (gatePorts.some((port) => port.portId === e.targetHandle) ||
              e.targetHandle === blockCrossingHandleV2({ nodeId, fieldOrPortId: 'auto_offload', direction: 'input' })),
        )
      ) {
        delete visible[control.controlId];
        continue;
      }
      if (
        ['revision', 'trust_remote_code', 'attention_backend'].includes(fieldId) &&
        control.label === declared?.label &&
        !field.fieldOptions?.controlTier
      ) {
        visible[control.controlId] = { ...field, fieldOptions: { ...field.fieldOptions, controlTier: 'advanced' } };
      }
    }
    // Portable graphs can retain the unfiltered loader schema. Use an exact,
    // unconnected selector as evidence instead of resolving a supplier or reseeding a value.
    if (
      nodeKey === IMAGE_LOADER &&
      ((fieldId === CONDITIONING_MODEL && declared?.display === 'modelselect') ||
        (fieldId === CONDITIONING_REVISION && declared?.type === 'string')) &&
      control.label === declared.label &&
      control.group === owner.data.label?.trim() &&
      !control.sealed &&
      !control.mirrorBindings?.length &&
      !owner.data.uiState?.disabled &&
      conditioning?.value === 'none' &&
      !conditioning.isConnected &&
      !conditioning.signal &&
      !declared.isConnected &&
      !declared.signal &&
      !hasControlSupplier(
        instance,
        owner,
        [CONDITIONING_KIND, CONDITIONING_MODEL, CONDITIONING_REVISION],
        graph.edges,
        workflowEdges,
      )
    ) {
      delete visible[control.controlId];
      continue;
    }
    if (
      hasAdapterRevision &&
      fieldId === 'revision' &&
      control.label === 'Revision' &&
      [IMAGE_LOADER, AUDIO_LOADER, 'modules.ModularDiffusers.ModelsLoader'].includes(nodeKey)
    ) {
      visible[control.controlId] = { ...visible[control.controlId]!, label: 'Base model revision' };
    }
    const recipeField = RECIPE_FALLBACKS[nodeKey]?.[fieldId];
    const recipeInput = owner.data.params[RECIPE_SOCKET];
    if (
      !recipeField ||
      control.sealed ||
      control.mirrorBindings?.length ||
      control.label !== owner.data.params[fieldId]?.label ||
      owner.data.uiState?.disabled ||
      recipeInput?.type !== RECIPE_TYPE ||
      !(recipeInput.display === 'input' || recipeInput.isInput) ||
      declared?.dataSource ||
      declared?.isConnected ||
      declared?.signal ||
      recipeInput.dataSource ||
      hasControlSupplier(instance, owner, [fieldId], graph.edges, workflowEdges) ||
      hasControlSupplier(instance, owner, [RECIPE_SOCKET], [], workflowEdges)
    )
      continue;
    const incoming = graph.edges.filter((edge) => edge.target === owner.id && edge.targetHandle === RECIPE_SOCKET);
    if (incoming.length !== 1 || incoming[0]?.sourceHandle !== RECIPE_SOCKET) continue;
    const recipe = nodes.get(incoming[0].source);
    if (
      !recipe ||
      `${recipe.data.module}.${recipe.data.action}` !== EXECUTION_RECIPE_NODE ||
      recipe.data.uiState?.disabled ||
      recipe.data.params[RECIPE_SOCKET]?.type !== RECIPE_TYPE ||
      recipe.data.params[RECIPE_SOCKET].display !== 'output'
    )
      continue;
    const setting = recipe.data.params[recipeField];
    const placement = recipeField === 'offload_mode' || recipeField === 'device';
    if (setting?.type !== (placement ? 'string' : 'bool')) continue;
    const literal = setting.value ?? setting.default;
    if (
      placement &&
      (typeof literal !== 'string' ||
        !literal.trim() ||
        setting.dataSource ||
        setting.signal ||
        setting.isConnected ||
        hasControlSupplier(instance, recipe, [recipeField], graph.edges, workflowEdges))
    )
      continue;
    const effective = controls.find(
      (candidate) =>
        candidate.binding.nodeId === recipe.data.blockProjectionNodeId && candidate.binding.fieldId === recipeField,
    );
    const effectiveParam = effective && params[effective.controlId];
    if (effectiveParam && !effectiveParam.hidden) delete visible[control.controlId];
  }
  for (const member of graph.nodes) {
    if (`${member.data.module}.${member.data.action}` !== EXECUTION_RECIPE_NODE || member.data.uiState?.disabled)
      continue;
    const localControls = new Map(
      controls
        .filter(
          (control) =>
            control.binding.nodeId === member.data.blockProjectionNodeId &&
            !control.sealed &&
            !control.mirrorBindings?.length &&
            control.group === member.data.label?.trim() &&
            control.label === member.data.params[control.binding.fieldId]?.label,
        )
        .map((control) => [control.binding.fieldId, control.controlId]),
    );
    visible = visibleExecutionRecipeControls(
      visible,
      member.data.params,
      (key) => hasControlSupplier(instance, member, [key], graph.edges, workflowEdges),
      (key) => localControls.get(key),
    );
  }
  return visible;
}
