import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeData, NodeParams } from '../stores/useNodeStore';
import type { Edge } from '@xyflow/react';
import { visualStageForNode, stageDefinition, type StageMode, type VisualCatalog } from './visualNodeCatalog';
import { matchingNodeHandleForDrop } from '../workflow/nodeConnectionMatching';
import { acceptsOperationValue } from '../workflow/operationFieldValue';
import { nodeDisplayLabel } from '../workflow/nodePresentation';

function editable(p: NodeParams) {
  return p.value !== undefined && p.display !== 'output' && !p.display?.startsWith('ui_');
}

/** Restore only settings previously authored for the exact destination action.
 * A change of stage mode must never send an image model ID to an audio loader. */
export function changeStageAction(
  node: CustomNodeType,
  mode: StageMode,
  catalog: VisualCatalog,
  registry: Record<string, NodeData>,
  nodes: CustomNodeType[],
  edges: Edge[],
) {
  const data = node.data;
  const current = visualStageForNode(catalog, data);
  if (
    node.parentId ||
    data.operationAuthoring ||
    data.studioRole ||
    data.blockProjectionOwnerId ||
    data.blockInstanceV2 ||
    !current ||
    !current.stage.modes.includes(mode) ||
    current.mode.guidance ||
    mode.guidance
  )
    throw Error('Use the owning workflow to change this stage.');
  const desired = stageDefinition(mode, registry);
  if (!desired) throw Error('This action is unavailable.');
  const key = data.module + '.' + data.action,
    same = key === mode.node;
  const defs = same ? { ...data.params } : { ...desired.params };
  const owned = Object.fromEntries(
    Object.entries(data.params)
      .filter(([, p]) => editable(p))
      .map(([k, p]) => [k, p.value]),
  );
  const drafts = { ...data.uiState?.stageActionDrafts, [key]: owned };
  if (!same) {
    for (const [field, value] of Object.entries(drafts[mode.node] ?? {})) {
      const p = defs[field];
      if (
        p &&
        !p.disabled &&
        p.display !== 'output' &&
        !p.display?.startsWith('ui_') &&
        acceptsOperationValue(p, value)
      )
        defs[field] = { ...p, value };
    }
  }
  for (const [k, value] of Object.entries(mode.settings ?? {})) {
    if (edges.some((e) => e.target === node.id && e.targetHandle === k))
      throw Error('Disconnect ' + (defs[k]?.label ?? k) + ' before changing this action.');
    defs[k] = { ...defs[k], value };
  }
  const next: NodeData = {
    ...desired,
    params: defs,
    label: registry[key] && nodeDisplayLabel(data) === nodeDisplayLabel(registry[key]!) ? desired.label : data.label,
    uiState: { ...data.uiState, stageActionDrafts: drafts },
  };
  delete next.searchTerms;
  for (const edge of edges.filter((e) => e.source === node.id || e.target === node.id)) {
    const upstream = edge.target === node.id;
    const field = upstream ? edge.targetHandle : edge.sourceHandle;
    const peerField = upstream ? edge.sourceHandle : edge.targetHandle;
    const peer = nodes.find((p) => p.id === (upstream ? edge.source : edge.target));
    if (
      !field ||
      !peerField ||
      !peer ||
      !matchingNodeHandleForDrop(
        next,
        peer.data.params[peerField]?.type,
        upstream ? 'source' : 'target',
        { node: peer.data, handleId: peerField },
        true,
        field,
      )
    )
      throw Error(
        'The ' +
          (data.params[field ?? '']?.label ?? field ?? 'existing') +
          ' connection is incompatible with ' +
          mode.label +
          '. Review the wire before changing this action.',
      );
  }
  return next;
}
