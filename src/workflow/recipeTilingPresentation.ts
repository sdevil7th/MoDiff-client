import type { Edge } from '@xyflow/react';
import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeParams } from '../stores/useNodeStore';
import type { StudioModelProfile } from '../studio/types';
import type { BlockInstanceV2 } from '../studio/blockSchemaV2';
import { blockMemberHasExternalWireV2 } from '../studio/blockCrossingConnectionsV2';
import { blockOperationGraphV2, type BlockFlowGraphV2 } from '../studio/blockRuntimeV2';

const recipePort = 'execution_recipe';
const selectionFields = ['model_id', 'pipeline_class', 'revision'];

/** A saved recipe is still the author's fallback. Derive the displayed state
 * from its consumers, including independent branches which still use that value. */
function recipeTilingPolicy(
  recipeId: string,
  nodes: readonly CustomNodeType[],
  edges: readonly Edge[],
  capabilities: readonly StudioModelProfile[],
  externalConsumer = false,
  externalSelection: (loader: CustomNodeType, fields: string[]) => boolean = () => false,
) {
  const routes = edges.filter((edge) => edge.source === recipeId && edge.sourceHandle === recipePort);
  let mandatory = 0;
  for (const route of routes) {
    const loader = nodes.find((node) => node.id === route.target);
    if (!loader || loader.data.uiState?.disabled || route.targetHandle !== recipePort) continue;
    const fields = loader.data.params;
    if (
      fields[recipePort]?.type !== 'diffusers_execution_recipe' ||
      fields[recipePort].dataSource ||
      selectionFields.some((key) => fields[key]?.dataSource || fields[key]?.signal || fields[key]?.isConnected) ||
      edges.some((edge) => edge.target === loader.id && selectionFields.includes(edge.targetHandle ?? '')) ||
      externalSelection(loader, [...selectionFields, recipePort])
    )
      continue;
    const model = fields.model_id?.value ?? fields.model_id?.default;
    const repo =
      typeof model === 'object' && model !== null && 'source' in model && model.source === 'hub' && 'value' in model
        ? model.value
        : model;
    const pipeline = fields.pipeline_class?.value ?? fields.pipeline_class?.default;
    const revision = fields.revision?.value ?? fields.revision?.default;
    if (
      capabilities.some(
        (cap) =>
          cap.requiresVaeTiling &&
          cap.defaultRepo === repo &&
          (revision === '' ||
            revision == null ||
            (typeof revision === 'string' && cap.revisionCandidates?.includes(revision))) &&
          cap.executionProfiles?.some(
            (profile) =>
              profile.loader_module === loader.data.module &&
              profile.loader_action === loader.data.action &&
              profile.pipeline_class === pipeline &&
              profile.default_repo === repo,
          ),
      )
    )
      mandatory++;
  }
  if (!mandatory) return undefined;
  return mandatory === routes.length && !externalConsumer ? 'required' : 'shared';
}

export function stageRecipeTilingPolicy(
  recipe: CustomNodeType,
  graph: BlockFlowGraphV2,
  instance: BlockInstanceV2,
  workflowEdges: readonly Edge[],
  capabilities: readonly StudioModelProfile[],
) {
  return recipeTilingPolicy(
    recipe.id,
    graph.nodes,
    graph.edges,
    capabilities,
    blockMemberHasExternalWireV2(instance, recipe.data.blockProjectionNodeId!, [recipePort], 'output', workflowEdges),
    (loader, names) =>
      blockMemberHasExternalWireV2(instance, loader.data.blockProjectionNodeId!, names, 'input', workflowEdges),
  );
}

export function workflowRecipeTilingPolicy(
  recipe: CustomNodeType,
  nodes: readonly CustomNodeType[],
  edges: readonly Edge[],
  capabilities: readonly StudioModelProfile[],
) {
  if (recipe.data.blockProjectionOwnerId) {
    const instance = nodes.find((n) => n.id === recipe.data.blockProjectionOwnerId)?.data.blockInstanceV2;
    if (!instance) return undefined;
    return stageRecipeTilingPolicy(recipe, blockOperationGraphV2(instance), instance, edges, capabilities);
  }
  return recipeTilingPolicy(recipe.id, nodes, edges, capabilities);
}

export function effectiveRecipeTiling(
  params: Record<string, NodeParams>,
  id: string | undefined,
  policy: ReturnType<typeof recipeTilingPolicy>,
) {
  if (!policy || !id || !params[id]) return params;
  const field = params[id];
  if (field.type !== 'bool' || field.hidden) return params;
  const suffix = policy === 'required' ? ' (required by model)' : ' (optional models only)';
  const name = field.label || 'VAE Tiling';
  const label = name.endsWith(suffix) ? name : name + suffix;
  return {
    ...params,
    [id]: policy === 'required' ? { ...field, value: true, disabled: true, label } : { ...field, label },
  };
}
