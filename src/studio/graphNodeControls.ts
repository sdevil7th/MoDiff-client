import type { Edge } from '@xyflow/react';
import { hasInlineScalarControl } from './inlineScalarControl';
import { useFlowStore, type CustomNodeType } from '../stores/useFlowStore';
import { useNodesStore, type NodeParams } from '../stores/useNodeStore';
import { useStudioStore } from '../stores/useStudioStore';
import {
  blockControlParamsV2,
  blockModularParentIdsV2,
  blockOperationGraphV2,
  materializeBlockProjectionV2,
} from './blockRuntimeV2';
import type { BlockJsonValue } from './blockSchemaV2';
import { syncManagedNodeControlChange } from './managedControlSync';
import type { AppModeInput } from './types';
import { modelSetupControlPresentation } from '../workflow/modelSetupControlPresentation';
import { EXECUTION_RECIPE_NODE, visibleExecutionRecipeControls } from '../workflow/gatedNodeControls';
import { visualOperationGroup } from '../workflow/visualOperationGroupProjection';
import { isFocusedStageNode } from '../workflow/encodingNodePresentation';
import { effectiveRecipeTiling, workflowRecipeTilingPolicy } from '../workflow/recipeTilingPresentation';

export type GraphInputCandidate = AppModeInput & { node: CustomNodeType; param: NodeParams };

const previewDisplays = new Set(['ui_image', 'ui_video', 'ui_audio', 'ui_text', 'ui_imagecompare']);
const controlsBySource = new WeakMap<object, Record<string, NodeParams>>();
const expandedByInstance = new WeakMap<object, CustomNodeType[]>();

/** The inspector is another view of the canvas control contract, never a schema owner. */
export function graphNodeControlParams(
  node: CustomNodeType,
  workflowEdges: readonly Edge[] = [],
  catalog: Pick<
    ReturnType<typeof useNodesStore.getState>,
    'workflowModelDescriptors' | 'studioModelCapabilities'
  > = useNodesStore.getState(),
  workflowNodes: readonly CustomNodeType[] = useFlowStore.getState().nodes,
): Record<string, NodeParams> {
  const instance = node.data.blockInstanceV2;
  const source = instance ?? node.data.params;
  const setup = instance && visualOperationGroup(node) === 'setup';
  // Model Setup depends on current adapter policy and connected suppliers.
  const recipe = !instance && `${node.data.module}.${node.data.action}` === EXECUTION_RECIPE_NODE;
  const cacheable = !setup && !recipe;
  const cached = cacheable ? controlsBySource.get(source) : undefined;
  if (cached) return cached;
  const base = instance ? blockControlParamsV2(instance) : node.data.params;
  const params = setup
    ? modelSetupControlPresentation(instance, blockOperationGraphV2(instance), base, workflowEdges, catalog).params
    : recipe
      ? visibleExecutionRecipeControls(
          effectiveRecipeTiling(
            base,
            'vae_tiling',
            workflowRecipeTilingPolicy(node, workflowNodes, workflowEdges, catalog.studioModelCapabilities),
          ),
          node.data.params,
          (key) => workflowEdges.some((edge) => edge.target === node.id && edge.targetHandle === key),
        )
      : base;
  const controls = Object.fromEntries(
    Object.entries(params)
      .filter(([key, param]) => {
        const display = param.isInput ? 'input' : param.display || '';
        return (
          (display !== 'input' || hasInlineScalarControl(param)) &&
          display !== 'output' &&
          !previewDisplays.has(display) &&
          !param.hidden &&
          !['output', 'images', 'latents'].includes(key)
        );
      })
      .map(([key, param]) => [
        key,
        {
          ...param,
          // The canvas/finalizer owns initial schema discovery. Mounting a second
          // view must not dispatch the same action or change the graph on selection.
          fieldOptions: { ...param.fieldOptions, suppressInitialFieldAction: true },
        },
      ]),
  );
  if (cacheable) controlsBySource.set(source, controls);
  return controls;
}

export function graphParamInputCandidates(
  nodes: CustomNodeType[],
  pinnedIds: string[] = [],
  workflowEdges: readonly Edge[] = [],
  workflowNodes: readonly CustomNodeType[] = nodes,
): GraphInputCandidate[] {
  const candidates: GraphInputCandidate[] = nodes.flatMap((node) =>
    Object.entries(graphNodeControlParams(node, workflowEdges, undefined, workflowNodes)).map(([key, param]) => ({
      id: `graph:${node.id}:${key}`,
      kind: 'graph-param' as const,
      label: `${node.data.label || node.id} / ${param.label || key}`,
      nodeId: node.id,
      paramKey: key,
      node,
      param,
    })),
  );
  const missingPins = new Set(pinnedIds.filter((id) => !candidates.some((candidate) => candidate.id === id)));
  if (!missingPins.size) return candidates;
  const visibleIds = new Set(nodes.map(({ id }) => id));
  for (const root of nodes) {
    const instance = root.data.blockInstanceV2;
    if (!instance || ![...missingPins].some((id) => id.startsWith(`graph:block-v2-node:${root.id.length}:${root.id}:`)))
      continue;
    let expanded = expandedByInstance.get(instance);
    if (!expanded) {
      // Read a full projection without changing the owning document's disclosure.
      expanded = materializeBlockProjectionV2({
        ...root,
        data: {
          ...root.data,
          blockInstanceV2: {
            ...instance,
            presentation: {
              ...instance.presentation,
              expanded: true,
              ...(isFocusedStageNode(instance) ? { stageEditorOpen: true } : {}),
              collapsedContainerNodeIds: [],
            },
          },
        },
      }).nodes;
      expandedByInstance.set(instance, expanded);
    }
    candidates.push(
      ...graphParamInputCandidates(
        expanded.filter(({ id }) => !visibleIds.has(id)),
        [],
        workflowEdges,
        workflowNodes,
      ).filter(({ id }) => missingPins.has(id)),
    );
  }
  return candidates;
}

/** Hidden pinned inputs remain readable; revealing their ancestors is explicit. */
export function revealPinnedGraphInput(workflowId: string | null, node: CustomNodeType) {
  if (useStudioStore.getState().activeWorkflowTabId !== workflowId) return;
  const ownerId = node.data.blockProjectionOwnerId;
  const instance = useFlowStore.getState().nodes.find(({ id }) => id === ownerId)?.data.blockInstanceV2;
  if (!instance || !ownerId || !node.data.blockProjectionNodeId) return;
  const parents = blockModularParentIdsV2(instance);
  const ancestors = new Set<string>();
  let parent = parents.get(node.data.blockProjectionNodeId);
  while (parent) {
    ancestors.add(parent);
    parent = parents.get(parent);
  }
  useFlowStore.getState().setBlockPresentationV2(ownerId, {
    expanded: true,
    ...(isFocusedStageNode(instance) ? { stageEditorOpen: true } : {}),
    collapsedContainerNodeIds: (instance.presentation.collapsedContainerNodeIds ?? []).filter(
      (id) => !ancestors.has(id),
    ),
  });
}

export function updateGraphNodeControl(
  workflowId: string | null,
  nodeId: string,
  param: string,
  value: unknown,
  key?: keyof NodeParams,
  fieldActionOrigin?: string,
) {
  if (useStudioStore.getState().activeWorkflowTabId !== workflowId) return;
  const flow = useFlowStore.getState();
  const node = flow.nodes.find(({ id }) => id === nodeId);
  if (!node) return;
  if (fieldActionOrigin !== undefined) {
    // Visibility limits direct editing, not the backend-declared action contract.
    // Actions may reveal hidden controls or send signals through connectors.
    const params = node.data.blockInstanceV2 ? blockControlParamsV2(node.data.blockInstanceV2) : node.data.params;
    if (
      !Object.prototype.hasOwnProperty.call(params, fieldActionOrigin) ||
      !Object.prototype.hasOwnProperty.call(params, param)
    )
      return;
  } else if (!graphNodeControlParams(node, flow.edges)[param]) return;
  if (node.data.blockInstanceV2) {
    if (key === undefined || key === 'value') flow.setBlockInstanceValueV2(nodeId, param, value as BlockJsonValue);
    return;
  }
  if (fieldActionOrigin !== undefined) flow.setParam(nodeId, param, value, key);
  else flow.setParamWithHistory(nodeId, param, value, key);
  syncManagedNodeControlChange(nodeId, param, value, key);
}
